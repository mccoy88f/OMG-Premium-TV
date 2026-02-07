const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const cron = require('node-cron');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

function safeEpgDbName(sessionKey) {
    if (!sessionKey || sessionKey === '_default') return 'epg.db';
    const hash = crypto.createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 16);
    return `epg_${hash}.db`;
}

class EPGManager {
    constructor(sessionKey = null) {
        this.sessionKey = sessionKey;
        this.epgData = null;
        this.db = null;
        this.dbPath = path.join(__dirname, '..', 'data', safeEpgDbName(sessionKey));
        this.lastUpdate = null;
        this.isUpdating = false;
        this.CHUNK_SIZE = 5000;
        this.lastEpgUrl = null;
        this.cronJob = null;
        this.cleanupJob = null;
        this.validateAndSetTimezone();
        if (!sessionKey) {
            this.initializeDatabase();
        }
        this.schedulePeriodicCleanup();
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
            } else {
                this.db = new SQL.Database();
            }

            // Crea schema
            this.db.run(`
                CREATE TABLE IF NOT EXISTS programs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL,
                    start_time INTEGER NOT NULL,
                    stop_time INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    category TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_channel_time 
                    ON programs(channel_id, start_time, stop_time);
                CREATE INDEX IF NOT EXISTS idx_stop_time 
                    ON programs(stop_time);
                    
                CREATE TABLE IF NOT EXISTS channel_icons (
                    channel_id TEXT PRIMARY KEY,
                    icon_url TEXT NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);

            } catch (error) {
            logger.error(this.sessionKey, 'EPG DB init error:', error.message);
        }
    }

    saveDatabase() {
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
        } catch (error) {
            logger.error(this.sessionKey, 'EPG DB save error:', error.message);
        }
    }

    normalizeId(id) {
        const beforeAt = (typeof id === 'string' && id.includes('@')) ? id.split('@')[0] : id;
        return beforeAt?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
    }

    /**
     * Restituisce gli id da provare per la lookup EPG: prima l'id normalizzato (es. canale5.it),
     * poi l'id senza suffisso dopo l'ultimo punto (es. canale5) per match con EPG XML (es. "Canale 5" -> canale5).
     */
    getLookupIds(channelId) {
        const normalized = this.normalizeId(channelId);
        if (!normalized) return [];
        const ids = [normalized];
        const lastDot = normalized.lastIndexOf('.');
        if (lastDot > 0) {
            const withoutSuffix = normalized.slice(0, lastDot);
            if (withoutSuffix && !ids.includes(withoutSuffix)) ids.push(withoutSuffix);
        }
        return ids;
    }

    validateAndSetTimezone() {
        const tzRegex = /^[+-]\d{1,2}:\d{2}$/;
        const timeZone = process.env.TIMEZONE_OFFSET || '+2:00';

        if (!tzRegex.test(timeZone)) {
            this.timeZoneOffset = '+2:00';
            return;
        }

        this.timeZoneOffset = timeZone;
        const [hours, minutes] = this.timeZoneOffset.substring(1).split(':');
        this.offsetMinutes = (parseInt(hours) * 60 + parseInt(minutes)) *
            (this.timeZoneOffset.startsWith('+') ? 1 : -1);
    }

    formatDateIT(date) {
        if (!date) return '';
        const localDate = new Date(date.getTime() + (this.offsetMinutes * 60000));
        return localDate.toLocaleString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\./g, ':');
    }

    parseEPGDate(dateString) {
        if (!dateString) return null;
        try {
            const regex = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$/;
            const match = dateString.match(regex);

            if (!match) return null;

            const [_, year, month, day, hour, minute, second, timezone] = match;
            const tzHours = timezone.substring(0, 3);
            const tzMinutes = timezone.substring(3);
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzHours}:${tzMinutes}`;

            const date = new Date(isoString);
            return isNaN(date.getTime()) ? null : date;
        } catch (error) {
            logger.error(this.sessionKey, 'EPG date parse error:', error.message);
            return null;
        }
    }

    async initializeEPG(url) {
        // Se l'URL è lo stesso e il database ha dati, skip
        if (this.lastEpgUrl === url && this.isEPGAvailable()) {
            return;
        }
        this.lastEpgUrl = url;
        await this.startEPGUpdate(url);
        if (!this.cronJob) {
            this.cronJob = cron.schedule('0 3 * * *', () => {
                this.startEPGUpdate(this.lastEpgUrl);
            });
            logger.log(this.sessionKey, 'EPG daily update scheduled (03:00)');
        }
        logger.log(this.sessionKey, 'EPG init done, URL:', url);
    }

    cleanupOldPrograms() {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const result = this.db.run('DELETE FROM programs WHERE stop_time < ?', [oneHourAgo]);
        this.saveDatabase();
        if (result.changes > 0) {
            logger.log(this.sessionKey, 'EPG cleanup: removed', result.changes, 'old program(s)');
        }
        return result.changes || 0;
    }

    schedulePeriodicCleanup() {
        if (this.cleanupJob) {
            return;
        }

        this.cleanupJob = cron.schedule('0 */6 * * *', () => {
            this.cleanupOldPrograms();
        });
    }

    async downloadAndProcessEPG(epgUrl) {
        try {
            const response = await axios.get(epgUrl.trim(), {
                responseType: 'arraybuffer',
                timeout: 100000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });

            let xmlString;
            try {
                xmlString = await gunzip(response.data);
                xmlString = xmlString.toString('utf8');
            } catch (gzipError) {
                try {
                    xmlString = zlib.inflateSync(response.data);
                    xmlString = xmlString.toString('utf8');
                } catch (zlibError) {
                    xmlString = response.data.toString('utf8');
                }
            }

            const xmlData = await parseStringPromise(xmlString);
            if (!xmlData || !xmlData.tv) {
                throw new Error('Struttura XML EPG non valida');
            }

            await this.processEPGInChunks(xmlData);
        } catch (error) {
            const msg = (error && error.message) || (typeof error === 'string' ? error : String(error)) || 'Unknown error';
            logger.error(this.sessionKey, 'EPG error:', msg);
        }
    }

    async processEPGInChunks(data) {
        if (!data.tv) {
            logger.error(this.sessionKey, 'EPG: no tv object in file');
            return;
        }
        if (data.tv && data.tv.channel) {

            const stmt = this.db.prepare('INSERT OR REPLACE INTO channel_icons (channel_id, icon_url) VALUES (?, ?)');

            for (const channel of data.tv.channel) {
                const id = this.normalizeId(channel.$.id);
                const icon = channel.icon?.[0]?.$?.src;
                if (id && icon) {
                    stmt.run([id, icon]);
                }
            }
            stmt.free();
        }

        if (!data.tv || !data.tv.programme) {
            logger.error(this.sessionKey, 'EPG: no programme in file');
            return;
        }
        const programs = data.tv.programme;
        let totalProcessed = 0;

        // Definisci limiti temporali
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        let skippedOld = 0;
        let skippedFuture = 0;

        // Prepara statement
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO programs 
            (channel_id, start_time, stop_time, title, description, category)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (let i = 0; i < programs.length; i += this.CHUNK_SIZE) {
            const chunk = programs.slice(i, i + this.CHUNK_SIZE);

            for (const program of chunk) {
                const channelId = this.normalizeId(program.$.channel);
                const start = this.parseEPGDate(program.$.start);
                const stop = this.parseEPGDate(program.$.stop);

                if (!start || !stop) continue;

                // Salta programmi troppo vecchi
                if (stop < oneHourAgo) {
                    skippedOld++;
                    continue;
                }

                // Salta programmi troppo lontani nel futuro
                if (start > sevenDaysFromNow) {
                    skippedFuture++;
                    continue;
                }

                let title = program.title?.[0]?._ ?? program.title?.[0]?.$?.text ?? program.title?.[0];
                let description = program.desc?.[0]?._ ?? program.desc?.[0]?.$?.text ?? program.desc?.[0];
                let category = program.category?.[0]?._ ?? program.category?.[0]?.$?.text ?? program.category?.[0];
                title = (title != null && typeof title === 'object') ? (title.text || title._ || String(title)) : (title ?? 'Nessun Titolo');
                description = (description != null && typeof description === 'object') ? (description.text || description._ || String(description)) : (description ?? '');
                category = (category != null && typeof category === 'object') ? (category.text || category._ || String(category)) : (category ?? '');
                title = String(title);
                description = String(description);
                category = String(category);

                stmt.run([
                    channelId,
                    start.getTime(),
                    stop.getTime(),
                    title,
                    description,
                    category
                ]);
                totalProcessed++;
            }
        }
        stmt.free();
        this.saveDatabase();
        logger.log(this.sessionKey, 'EPG processed:', totalProcessed, 'programs (skipped old:', skippedOld, ', future:', skippedFuture, ')');
    }

    async readExternalFile(url) {
        if (Array.isArray(url)) {
            return url;
        }

        if (url.includes(',')) {
            return url.split(',').map(u => u.trim());
        }

        try {
            if (url.endsWith('.gz')) return [url];
            const response = await axios.get(url.trim());
            const content = response.data;
            if (typeof content === 'string' &&
                (content.includes('<?xml') || content.includes('<tv'))) {
                return [url];
            }
            const urls = content.split('\n')
                .filter(line => line.trim() !== '' && line.startsWith('http'));
            if (urls.length > 0) return urls;
            return [url];
        } catch (error) {
            logger.error(this.sessionKey, 'EPG read file error:', error.message);
            return [url];
        }
    }

    async startEPGUpdate(url) {
        if (this.isUpdating) {
            logger.log(this.sessionKey, 'EPG update already in progress, skip');
            return;
        }
        const startTime = Date.now();
        try {
            this.isUpdating = true;
            const epgUrls = await this.readExternalFile(url);

            // Pulisci database
            this.db.run('DELETE FROM programs');
            this.db.run('DELETE FROM channel_icons');

            for (const epgUrl of epgUrls) {
                await this.downloadAndProcessEPG(epgUrl);
            }
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const channelsCount = this.db.exec('SELECT COUNT(DISTINCT channel_id) as count FROM programs')[0]?.values[0]?.[0] || 0;
            this.cleanupOldPrograms();
            logger.log(this.sessionKey, 'EPG update done in', duration, 's, channels:', channelsCount);
        } catch (error) {
            logger.error(this.sessionKey, 'EPG update error:', error.message);
        } finally {
            this.isUpdating = false;
            this.lastUpdate = Date.now();
        }
    }

    getCurrentProgram(channelId) {
        if (!channelId || !this.db) return null;
        const now = Date.now();
        const ids = this.getLookupIds(channelId);

        for (const normalizedId of ids) {
            try {
                const result = this.db.exec(`
                    SELECT title, description, category, start_time, stop_time
                    FROM programs
                    WHERE channel_id = ? AND start_time <= ? AND stop_time >= ?
                    LIMIT 1
                `, [normalizedId, now, now]);

                if (result.length > 0 && result[0].values.length > 0) {
                    const row = result[0].values[0];
                    return {
                        title: row[0],
                        description: row[1],
                        category: row[2],
                        start: this.formatDateIT(new Date(row[3])),
                        stop: this.formatDateIT(new Date(row[4]))
                    };
                }
            } catch (error) {
                logger.error(this.sessionKey, 'getCurrentProgram error:', error.message);
            }
        }

        return null;
    }

    getUpcomingPrograms(channelId) {
        if (!channelId || !this.db) return [];
        const now = Date.now();
        const ids = this.getLookupIds(channelId);

        for (const normalizedId of ids) {
            try {
                const result = this.db.exec(`
                    SELECT title, description, category, start_time, stop_time
                    FROM programs
                    WHERE channel_id = ? AND start_time >= ?
                    ORDER BY start_time ASC
                    LIMIT 2
                `, [normalizedId, now]);

                if (result.length > 0 && result[0].values.length > 0) {
                    return result[0].values.map(row => ({
                        title: row[0],
                        description: row[1],
                        category: row[2],
                        start: this.formatDateIT(new Date(row[3])),
                        stop: this.formatDateIT(new Date(row[4]))
                    }));
                }
            } catch (error) {
                logger.error(this.sessionKey, 'getUpcomingPrograms error:', error.message);
            }
        }

        return [];
    }

    getChannelIcon(channelId) {
        if (!channelId || !this.db) return null;
        const ids = this.getLookupIds(channelId);

        for (const normalizedId of ids) {
            try {
                const result = this.db.exec(`
                    SELECT icon_url FROM channel_icons WHERE channel_id = ?
                `, [normalizedId]);

                if (result.length > 0 && result[0].values.length > 0) {
                    return result[0].values[0][0];
                }
            } catch (error) {
                logger.error(this.sessionKey, 'getChannelIcon error:', error.message);
            }
        }

        return null;
    }

    needsUpdate() {
        if (!this.lastUpdate) return true;
        return (Date.now() - this.lastUpdate) >= (24 * 60 * 60 * 1000);
    }

    isEPGAvailable() {
        if (!this.db || this.isUpdating) return false;

        try {
            const result = this.db.exec('SELECT COUNT(*) as count FROM programs');
            return result.length > 0 && result[0].values[0][0] > 0;
        } catch {
            return false;
        }
    }

    getStatus() {
        let channelsCount = 0;
        let iconsCount = 0;
        let programsCount = 0;

        if (this.db) {
            try {
                const channelsResult = this.db.exec('SELECT COUNT(DISTINCT channel_id) as count FROM programs');
                channelsCount = channelsResult[0]?.values[0]?.[0] || 0;

                const iconsResult = this.db.exec('SELECT COUNT(*) as count FROM channel_icons');
                iconsCount = iconsResult[0]?.values[0]?.[0] || 0;

                const programsResult = this.db.exec('SELECT COUNT(*) as count FROM programs');
                programsCount = programsResult[0]?.values[0]?.[0] || 0;
            } catch (error) {
                logger.error(this.sessionKey, 'getStatus error:', error.message);
            }
        }

        return {
            isUpdating: this.isUpdating,
            lastUpdate: this.lastUpdate ? this.formatDateIT(new Date(this.lastUpdate)) : 'Mai',
            channelsCount,
            iconsCount,
            programsCount,
            timezone: this.timeZoneOffset,
            storageType: 'SQLite (Disk)'
        };
    }

    checkMissingEPG(m3uChannels) {
        if (!this.db) return;

        try {
            const result = this.db.exec('SELECT DISTINCT channel_id FROM programs');
            const epgChannels = result[0]?.values.map(row => row[0]) || [];
            const missingEPG = [];

            m3uChannels.forEach(ch => {
                const tvgId = ch.streamInfo?.tvg?.id;
                if (tvgId) {
                    const normalizedTvgId = this.normalizeId(tvgId);
                    if (!epgChannels.some(epgId => this.normalizeId(epgId) === normalizedTvgId)) {
                        missingEPG.push(ch);
                    }
                }
            });

            if (missingEPG.length > 0) {
                logger.log(this.sessionKey, 'M3U channels without EPG:', missingEPG.length);
            }
        } catch (error) {
            logger.error(this.sessionKey, 'checkMissingEPG error:', error.message);
        }
    }
}

const registry = new Map();
const defaultInstance = new EPGManager();

async function getEPGManager(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return defaultInstance;
    if (!registry.has(key)) {
        const instance = new EPGManager(key);
        await instance.initializeDatabase();
        registry.set(key, instance);
    }
    return registry.get(key);
}

/**
 * Rimuove una sessione EPG (cron, file DB). Non usare per _default.
 * @param {string} sessionKey
 */
function removeEPGSession(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return;
    const instance = registry.get(key);
    if (!instance) return;
    try {
        if (instance.cronJob) {
            instance.cronJob.stop();
            instance.cronJob = null;
        }
        if (instance.cleanupJob) {
            instance.cleanupJob.stop();
            instance.cleanupJob = null;
        }
        if (instance.dbPath && fs.existsSync(instance.dbPath)) {
            fs.unlinkSync(instance.dbPath);
            logger.log(key, 'EPG session removed:', instance.dbPath);
        }
    } catch (e) {
        logger.error(key, 'EPG session removal error:', e.message);
    }
    instance.db = null;
    registry.delete(key);
}

module.exports = defaultInstance;
module.exports.getEPGManager = getEPGManager;
module.exports.removeEPGSession = removeEPGSession;
