const EventEmitter = require('events');
const PlaylistTransformer = require('./playlist-transformer');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

function safeSessionDbName(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return 'cache.db';
    const hash = crypto.createHash('sha256').update(sessionId.trim()).digest('hex').slice(0, 16);
    return `cache_${hash}.db`;
}

class CacheManager extends EventEmitter {
    constructor(sessionId) {
        super();
        this.sessionId = sessionId || null;
        this.transformer = new PlaylistTransformer();
        this.config = null;
        this.cache = null;
        this.pollingInterval = null;
        this.lastFilter = null;
        this.db = null;
        this.dbPath = path.join(__dirname, '..', 'data', safeSessionDbName(sessionId));
    }

    _sk() {
        return (this.sessionKey != null ? this.sessionKey : this.sessionId) || '_';
    }

    async initializeDatabase() {
        try {
            // Crea directory data se non esiste
            const dataDir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Inizializza SQL.js
            const SQL = await initSqlJs();

            // Carica database esistente o crea nuovo
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(buffer);
                logger.log(this._sk(), 'Cache database loaded from disk');
            } else {
                this.db = new SQL.Database();
                logger.log(this._sk(), 'New cache database created');
            }

            // Crea schema
            this.db.run(`
                CREATE TABLE IF NOT EXISTS channels (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS genres (
                    genre TEXT PRIMARY KEY
                );

                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);

            logger.log(this._sk(), 'Cache database schema initialized');
        } catch (error) {
            logger.error(this._sk(), 'Cache database init error:', error);
        }
    }

    saveDatabase() {
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
        } catch (error) {
            logger.error(this._sk(), 'Cache database save error:', error);
        }
    }

    loadCacheFromDB() {
        try {
            // Carica metadata
            const metadataResult = this.db.exec('SELECT key, value FROM metadata');
            const metadata = {};
            if (metadataResult.length > 0 && metadataResult[0].values) {
                metadataResult[0].values.forEach(row => {
                    metadata[row[0]] = row[1];
                });
            }

            // Carica canali
            const channelsResult = this.db.exec('SELECT id, data FROM channels');
            const channels = [];
            if (channelsResult.length > 0 && channelsResult[0].values) {
                channelsResult[0].values.forEach(row => {
                    try {
                        const channelData = JSON.parse(row[1]);
                        channels.push(channelData);
                    } catch (e) {
                        logger.error(this._sk(), 'Channel parse error:', row[0], e);
                    }
                });
            }

            // Carica generi
            const genresResult = this.db.exec('SELECT genre FROM genres');
            const genres = [];
            if (genresResult.length > 0 && genresResult[0].values) {
                genresResult[0].values.forEach(row => {
                    genres.push(row[0]);
                });
            }

            // Ricostruisci cache
            this.cache = {
                stremioData: channels.length > 0 ? { channels, genres } : null,
                lastUpdated: metadata.lastUpdated ? parseInt(metadata.lastUpdated) : null,
                updateInProgress: false,
                m3uUrl: metadata.m3uUrl || null,
                epgUrls: metadata.epgUrls ? JSON.parse(metadata.epgUrls) : []
            };

            if (channels.length > 0 || genres.length > 0) {
                logger.log(this._sk(), 'Loaded', channels.length, 'channels and', genres.length, 'genres from database');
            }
        } catch (error) {
            logger.error(this._sk(), 'Cache load from database error:', error);
            this.initCache();
        }
    }

    saveCacheToDB() {
        try {
            // Salva metadata
            if (this.cache.lastUpdated) {
                this.db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['lastUpdated', this.cache.lastUpdated.toString()]);
            }
            if (this.cache.m3uUrl) {
                this.db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['m3uUrl', this.cache.m3uUrl]);
            }
            if (this.cache.epgUrls && Array.isArray(this.cache.epgUrls)) {
                this.db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['epgUrls', JSON.stringify(this.cache.epgUrls)]);
            }

            // Salva canali
            if (this.cache.stremioData?.channels) {
                // Pulisci tabella canali
                this.db.run('DELETE FROM channels');

                const stmt = this.db.prepare('INSERT INTO channels (id, data) VALUES (?, ?)');
                this.cache.stremioData.channels.forEach(channel => {
                    try {
                        stmt.run([channel.id, JSON.stringify(channel)]);
                    } catch (e) {
                        logger.error(this._sk(), 'Channel save error:', channel.id, e);
                    }
                });
                stmt.free();
            }

            // Salva generi
            if (this.cache.stremioData?.genres) {
                // Pulisci tabella generi
                this.db.run('DELETE FROM genres');

                const stmt = this.db.prepare('INSERT INTO genres (genre) VALUES (?)');
                this.cache.stremioData.genres.forEach(genre => {
                    stmt.run([genre]);
                });
                stmt.free();
            }

            this.saveDatabase();
            logger.log(this._sk(), 'Cache saved to database');
        } catch (error) {
            logger.error(this._sk(), 'Cache save to database error:', error);
        }
    }

    initCache() {
        this.cache = {
            stremioData: null,
            lastUpdated: null,
            updateInProgress: false,
            m3uUrl: null,
            epgUrls: []
        };
        this.lastFilter = null;
    }

    ensureCacheLoaded() {
        if (this._cacheLoaded) return;
        this._cacheLoaded = true;
        this.loadCacheFromDB();
    }

    async updateConfig(newConfig) {
        // Verifica separatamente i cambiamenti di M3U e EPG
        const hasM3UChanges = this.config?.m3u !== newConfig.m3u;
        const hasEPGChanges =
            this.config?.epg_enabled !== newConfig.epg_enabled ||
            this.config?.epg !== newConfig.epg;

        // Verifica altri cambiamenti di configurazione
        const hasOtherChanges =
            this.config?.update_interval !== newConfig.update_interval ||
            this.config?.id_suffix !== newConfig.id_suffix ||
            this.config?.remapper_path !== newConfig.remapper_path;

        // Aggiorna la configurazione
        this.config = { ...this.config, ...newConfig };

        if (hasM3UChanges) {
            logger.log(this._sk(), 'M3U playlist changed, reloading playlist data...');
            // Resetta solo i dati della playlist
            this.cache.stremioData = null;
            this.cache.m3uUrl = null;

            if (this.config.m3u) {
                await this.rebuildCache(this.config.m3u, this.config);
            }
        }

        if (hasEPGChanges) {
            logger.log(this._sk(), 'EPG config changed, updating EPG only...');
            // Non tocchiamo i dati della playlist, lasciamo gestire l'EPG all'EPGManager
        }

        if (hasOtherChanges) {
            logger.log(this._sk(), 'Other config changed, restarting polling...');
            this.startPolling();
        }
    }

    startPolling() {
        // Pulisci eventuali polling precedenti
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Controlla ogni tot secondi se è necessario aggiornare
        this.pollingInterval = setInterval(async () => {
            // Controlla se abbiamo una cache valida
            if (!this.cache?.stremioData) {
                return;
            }

            if (this.isStale(this.config)) {
                logger.log(this._sk(), 'Checking cache update...');
                try {
                    await this.rebuildCache(this.cache.m3uUrl, this.config);
                } catch (error) {
                    logger.error(this._sk(), 'Auto-update error:', error);
                }
            }
        }, 60000); // 60 secondi
    }

    normalizeId(id, removeSuffix = false) {
        const beforeAt = (typeof id === 'string' && id.includes('@')) ? id.split('@')[0] : id;
        let normalized = beforeAt?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';

        if (removeSuffix && this.config?.id_suffix) {
            const suffix = `.${this.config.id_suffix}`;
            if (normalized.endsWith(suffix)) {
                normalized = normalized.substring(0, normalized.length - suffix.length);
            }
        }

        return normalized;
    }

    addSuffix(id) {
        if (!id || !this.config?.id_suffix) return id;
        const suffix = `.${this.config.id_suffix}`;
        return id.endsWith(suffix) ? id : `${id}${suffix}`;
    }

    async rebuildCache(m3uUrl, config) {
        if (this.cache.updateInProgress) {
            logger.log(this._sk(), 'Cache rebuild already in progress, skip');
            return;
        }

        try {
            this.cache.updateInProgress = true;
            logger.log(this._sk(), 'Cache rebuild started, M3U URL:', m3uUrl);

            if (config) {
                this.config = { ...this.config, ...config };
            }

            const data = await this.transformer.loadAndTransform(m3uUrl, this.config, this._sk());

            this.cache = {
                stremioData: data,
                lastUpdated: Date.now(),
                updateInProgress: false,
                m3uUrl: m3uUrl,
                epgUrls: data.epgUrls
            };
            this._cacheLoaded = true;

            logger.log(this._sk(), 'Channels in cache:', data.channels.length, ', genres:', data.genres.length, ', cache rebuilt');

            // Salva nel database
            this.saveCacheToDB();

            this.emit('cacheUpdated', this.cache);

        } catch (error) {
            logger.error(this._sk(), 'Cache rebuild error:', error);
            this.cache.updateInProgress = false;
            this.emit('cacheError', error);
            throw error;
        }
    }

    getCachedData() {
        this.ensureCacheLoaded();
        if (!this.cache || !this.cache.stremioData) return { channels: [], genres: [] };
        return {
            channels: this.cache.stremioData.channels,
            genres: this.cache.stremioData.genres
        };
    }

    getChannel(channelId) {
        this.ensureCacheLoaded();
        if (!channelId || !this.cache?.stremioData?.channels) return null;
        const normalizedSearchId = this.normalizeId(channelId);

        const channel = this.cache.stremioData.channels.find(ch => {
            const normalizedChannelId = this.normalizeId(ch.id.replace('tv|', ''));
            const normalizedTvgId = this.normalizeId(ch.streamInfo?.tvg?.id);

            return normalizedChannelId === normalizedSearchId ||
                normalizedTvgId === normalizedSearchId;
        });

        if (!channel) {
            return this.cache.stremioData.channels.find(ch =>
                this.normalizeId(ch.name) === normalizedSearchId
            );
        }

        return channel;
    }

    getChannelsByGenre(genre) {
        this.ensureCacheLoaded();
        if (!genre || !this.cache?.stremioData?.channels) return [];

        return this.cache.stremioData.channels.filter(channel => {
            if (!Array.isArray(channel.genre)) return false;
            const hasGenre = channel.genre.includes(genre);
            if (hasGenre) return true;
            const isSettingsGenre = genre === '⚙️' || genre === 'Settings';
            if (isSettingsGenre && (channel.genre.includes('~SETTINGS~') || channel.genre.includes('Settings'))) return true;
            return false;
        });
    }

    searchChannels(query) {
        this.ensureCacheLoaded();
        if (!this.cache?.stremioData?.channels) return [];
        if (!query) return this.cache.stremioData.channels;

        const normalizedQuery = this.normalizeId(query);

        return this.cache.stremioData.channels.filter(channel => {
            const normalizedName = this.normalizeId(channel.name);
            return normalizedName.includes(normalizedQuery);
        });
    }

    isStale(config = {}) {
        this.ensureCacheLoaded();
        if (!this.cache || !this.cache.lastUpdated || !this.cache.stremioData) return true;

        let updateIntervalMs = 12 * 60 * 60 * 1000;

        if (config.update_interval) {
            const timeMatch = config.update_interval.match(/^(\d{1,2}):(\d{2})$/);

            if (timeMatch) {
                const hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);

                if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                    updateIntervalMs = (hours * 60 * 60 + minutes * 60) * 1000;
                } else {
                    logger.warn(this._sk(), 'Invalid time format, using default value');
                }
            } else {
                logger.warn(this._sk(), 'Invalid time format, using default value');
            }
        }

        const timeSinceLastUpdate = Date.now() - this.cache.lastUpdated;

        const needsUpdate = timeSinceLastUpdate >= updateIntervalMs;
        if (needsUpdate) {
            logger.log(this._sk(), 'Cache stale, update needed');
        }

        return needsUpdate;
    }

    setLastFilter(filterType, value) {
        this.lastFilter = { type: filterType, value };
    }

    getLastFilter() {
        return this.lastFilter;
    }

    clearLastFilter() {
        this.lastFilter = null;
    }

    getFilteredChannels() {
        this.ensureCacheLoaded();
        if (!this.cache?.stremioData?.channels) return [];

        let channels = this.cache.stremioData.channels;

        if (this.lastFilter) {
            if (this.lastFilter.type === 'genre') {
                channels = this.getChannelsByGenre(this.lastFilter.value);
            } else if (this.lastFilter.type === 'search') {
                channels = this.searchChannels(this.lastFilter.value);
            }
        }

        return channels;
    }

    cleanup() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Distrugge la sessione: ferma polling e rimuove il file DB da disco.
     * Da usare quando la sessione scade (es. inattività 24h).
     */
    destroy() {
        this.cleanup();
        try {
            if (this.dbPath && fs.existsSync(this.dbPath)) {
                fs.unlinkSync(this.dbPath);
                console.log('Session cache removed:', this.dbPath);
            }
        } catch (e) {
            logger.error(this._sk(), 'Session cache removal error:', e.message);
        }
        this.db = null;
        this.cache = null;
    }
}

module.exports = async (config, sessionId) => {
    const instance = new CacheManager(sessionId);
    await instance.initializeDatabase();
    instance._cacheLoaded = false;
    instance.initCache();
    instance.config = config;
    instance.startPolling();
    return instance;
};
