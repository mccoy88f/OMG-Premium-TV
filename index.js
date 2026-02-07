const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { addonBuilder } = require('stremio-addon-sdk');
const PlaylistTransformer = require('./src/playlist-transformer');
const { catalogHandler, streamHandler } = require('./src/handlers');
const metaHandler = require('./src/meta-handler');
const EPGManagerModule = require('./src/epg-manager');
const getEPGManager = EPGManagerModule.getEPGManager;
const removeEPGSession = EPGManagerModule.removeEPGSession;
const config = require('./src/config');
const CacheManagerFactory = require('./src/cache-manager');
const { renderConfigPage, renderGatePage } = require('./views/views');
const homeAuth = require('./src/home-auth');
const PythonRunnerModule = require('./src/python-runner');
const PythonRunner = PythonRunnerModule;
const getPythonRunner = PythonRunnerModule.getPythonRunner;
const removeRunnerSession = PythonRunnerModule.removeRunnerSession;
const ResolverStreamManager = require('./src/resolver-stream-manager')();
const PythonResolverModule = require('./src/python-resolver');
const PythonResolver = PythonResolverModule;
const getPythonResolver = PythonResolverModule.getPythonResolver;
const removeResolverSession = PythonResolverModule.removeResolverSession;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./src/logger');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Chiave cache derivata dalla config (stessa config = stessa cache; nessun session_id scelto dall'utente)
function getSessionKeyFromConfig(userConfig) {
    if (!userConfig || typeof userConfig !== 'object') return '_default';
    const keys = ['m3u', 'epg', 'proxy', 'id_suffix', 'remapper_path', 'update_interval', 'resolver_script', 'python_script_url'];
    const o = {};
    keys.forEach(k => { if (userConfig[k] !== undefined && userConfig[k] !== '') o[k] = String(userConfig[k]); });
    const str = JSON.stringify(o);
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

const SETTINGS_GENRE = '⚙️';

function getGenreOptions(cacheManager) {
    const raw = (cacheManager.getCachedData().genres || []);
    const normalized = raw.map(g => (g === '~SETTINGS~' || g === 'Settings' ? SETTINGS_GENRE : g));
    return [...new Set([...normalized, SETTINGS_GENRE])];
}

// Registry cache per sessione (chiave derivata dalla config)
const cacheRegistry = new Map();

// Ultima attività per sessione (solo non-default). Scadenza 24h.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessionLastActivity = new Map();

function touchSession(sessionKey) {
    if (sessionKey && sessionKey !== '_default') {
        sessionLastActivity.set(sessionKey, Date.now());
    }
}

async function getCacheManager(sessionId, userConfig) {
    const key = (sessionId && String(sessionId).trim()) ? String(sessionId).trim() : getSessionKeyFromConfig(userConfig);
    if (!cacheRegistry.has(key)) {
        cacheRegistry.set(key, await CacheManagerFactory(userConfig || {}, key === '_default' ? null : key));
    }
    const cm = cacheRegistry.get(key);
    cm.sessionKey = key;
    if (userConfig && Object.keys(userConfig).length) cm.updateConfig(userConfig);
    touchSession(key);
    return cm;
}

/**
 * Elimina una sessione scaduta (cache, EPG, resolver, runner) e rimuove dai registry.
 * Non usare per _default.
 */
function expireSession(sessionKey) {
    if (sessionKey === '_default') return;
    const cm = cacheRegistry.get(sessionKey);
    if (cm) {
        cm.destroy();
        cacheRegistry.delete(sessionKey);
    }
    removeEPGSession(sessionKey);
    removeResolverSession(sessionKey);
    removeRunnerSession(sessionKey);
    sessionLastActivity.delete(sessionKey);
    logger.log(sessionKey, 'Session expired and removed');
}

/** Controlla sessioni inattive da più di 24h e le rimuove. */
function cleanupExpiredSessions() {
    const now = Date.now();
    const toExpire = new Set();
    for (const [key, last] of sessionLastActivity) {
        if (now - last >= SESSION_TTL_MS) toExpire.add(key);
    }
    // Anche sessioni in cache ma senza lastActivity (es. create prima del touch)
    for (const key of cacheRegistry.keys()) {
        if (key === '_default') continue;
        const last = sessionLastActivity.get(key);
        if (last === undefined || now - last >= SESSION_TTL_MS) toExpire.add(key);
    }
    toExpire.forEach(key => {
        try {
            expireSession(key);
        } catch (e) {
            logger.error(key, 'Session expiry error:', e.message);
        }
    });
}

// API per ottenere l'ID sessione dalla config (per UI e export)
app.post('/api/session-key', (req, res) => {
    try {
        const sessionKey = getSessionKeyFromConfig(req.body || {});
        res.json({ sessionKey });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// API protezione home (prima del gate per permettere chiamate senza cookie)
app.get('/api/home-auth/status', (req, res) => {
    res.json(homeAuth.getState());
});
app.post('/api/home-auth/set', (req, res) => {
    const { enabled, password, confirm } = req.body || {};
    const result = homeAuth.setProtection(!!enabled, password);
    res.json(result);
});
app.post('/api/home-auth/unlock', (req, res) => {
    const password = (req.body && req.body.password) || '';
    if (!homeAuth.verifyPassword(password)) {
        const returnUrl = (req.body && req.body.returnUrl) || '';
        const safeReturn = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '';
        return res.redirect(safeReturn ? `${safeReturn}${safeReturn.includes('?') ? '&' : '?'}error=1` : '/?error=1');
    }
    const value = homeAuth.getUnlockCookieValue();
    if (value) {
        res.cookie(homeAuth.COOKIE_NAME, value, {
            maxAge: homeAuth.COOKIE_MAX_AGE_MS,
            httpOnly: true,
            path: '/',
            sameSite: 'lax'
        });
    }
    const returnUrl = (req.body && req.body.returnUrl) || '';
    const safeReturn = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/';
    res.redirect(safeReturn);
});

// Route principale - supporta sia il vecchio che il nuovo sistema
app.get('/', async (req, res) => {
    const state = homeAuth.getState();
    if (state.enabled && !homeAuth.verifyUnlockCookie(req.cookies[homeAuth.COOKIE_NAME])) {
        return res.send(renderGatePage(config.manifest, req.path));
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const queryWithAuth = { ...req.query, homeAuthEnabled: state.enabled ? 'true' : 'false' };
    res.send(renderConfigPage(protocol, host, queryWithAuth, config.manifest));
});

// Nuova route per la configurazione codificata
app.get('/:config/configure', async (req, res) => {
    const state = homeAuth.getState();
    if (state.enabled && !homeAuth.verifyUnlockCookie(req.cookies[homeAuth.COOKIE_NAME])) {
        return res.send(renderGatePage(config.manifest, req.path));
    }
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));

        // Initialize Python generator from config if configured
        if (decodedConfig.python_script_url) {
            const sessionKey = getSessionKeyFromConfig(decodedConfig);
            const cacheManagerForConfig = await getCacheManager(decodedConfig.session_id, decodedConfig);
            const pythonRunnerForSession = getPythonRunner(sessionKey);
            try {
                await pythonRunnerForSession.downloadScript(decodedConfig.python_script_url);
                if (decodedConfig.python_update_interval) {
                    pythonRunnerForSession.scheduleUpdate(decodedConfig.python_update_interval, cacheManagerForConfig);
                }
                logger.log(sessionKey, 'Python generator initialized from config');
            } catch (pythonError) {
                logger.error(sessionKey, 'Python generator init error:', pythonError.message);
            }
        }

        const queryWithAuth = { ...decodedConfig, homeAuthEnabled: state.enabled ? 'true' : 'false' };
        const sessionKey = getSessionKeyFromConfig(decodedConfig);
        const showSessionChangeWarning = req.query.generated === '1' || req.query.generated === 'true';
        res.send(renderConfigPage(protocol, host, queryWithAuth, config.manifest, sessionKey, showSessionChangeWarning));
    } catch (error) {
        logger.error('_', 'Configure route error:', error.message);
        res.redirect('/');
    }
});

// Route per il manifest - supporta sia il vecchio che il nuovo sistema
app.get('/manifest.json', async (req, res) => {
    try {
        const cacheManager = await getCacheManager(req.query.session_id, req.query);
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configUrl = `${protocol}://${host}/?${new URLSearchParams(req.query)}`;
        if (req.query.resolver_update_interval) {
            configUrl += `&resolver_update_interval=${encodeURIComponent(req.query.resolver_update_interval)}`;
        }
        cacheManager.ensureCacheLoaded();
        const cacheEmpty = !cacheManager.cache?.stremioData?.channels?.length;
        if (req.query.m3u && (cacheManager.cache.m3uUrl !== req.query.m3u || cacheEmpty)) {
            await cacheManager.rebuildCache(req.query.m3u, req.query);
        } else if (cacheEmpty && !req.query.m3u) {
            logger.warn(cacheManager?.sessionKey ?? '_', 'Manifest: cache empty and no M3U URL in config — playlists will not load. Configure M3U and reinstall the addon.');
        }

        const genres = getGenreOptions(cacheManager);
        const manifestConfig = {
            ...config.manifest,
            catalogs: [{
                ...config.manifest.catalogs[0],
                extra: [
                    { name: 'genre', isRequired: false, options: genres },
                    { name: 'search', isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            }],
            behaviorHints: {
                configurable: true,
                configurationURL: configUrl,
                reloadRequired: true
            }
        };
        const builder = new addonBuilder(manifestConfig);

        if (req.query.epg_enabled === 'true') {
            const epgToUse = req.query.epg ||
                (cacheManager.getCachedData().epgUrls && cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',') : null);
            if (epgToUse) await epgManager.initializeEPG(epgToUse);
        }

        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner }));
        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error creating manifest:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Nuova route per il manifest con configurazione codificata
app.get('/:config/manifest.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');

        cacheManager.ensureCacheLoaded();
        const cacheEmpty = !cacheManager.cache?.stremioData?.channels?.length;
        if (decodedConfig.m3u && (cacheManager.cache.m3uUrl !== decodedConfig.m3u || cacheEmpty)) {
            await cacheManager.rebuildCache(decodedConfig.m3u, decodedConfig);
        } else if (cacheEmpty && !decodedConfig.m3u) {
            logger.warn(getSessionKeyFromConfig(decodedConfig), 'Manifest: cache empty and no M3U URL in config — playlists will not load. Configure M3U and reinstall the addon.');
        }
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);

        if (decodedConfig.resolver_script) {
            try {
                await pythonResolver.downloadScript(decodedConfig.resolver_script);
                if (decodedConfig.resolver_update_interval) {
                    pythonResolver.scheduleUpdate(decodedConfig.resolver_update_interval);
                }
                logger.log(sessionKey, 'Resolver initialized from config');
            } catch (resolverError) {
                logger.error(sessionKey, 'Resolver init error:', resolverError.message);
            }
        }
        if (decodedConfig.python_script_url) {
            try {
                await pythonRunner.downloadScript(decodedConfig.python_script_url);
                if (decodedConfig.python_update_interval) {
                    pythonRunner.scheduleUpdate(decodedConfig.python_update_interval, cacheManager);
                }
                logger.log(sessionKey, 'Python generator initialized from config');
            } catch (pythonError) {
                logger.error(sessionKey, 'Python generator init error:', pythonError.message);
            }
        }

        const genres = getGenreOptions(cacheManager);
        const manifestConfig = {
            ...config.manifest,
            catalogs: [{
                ...config.manifest.catalogs[0],
                extra: [
                    {
                        name: 'genre',
                        isRequired: false,
                        options: genres
                    },
                    {
                        name: 'search',
                        isRequired: false
                    },
                    {
                        name: 'skip',
                        isRequired: false
                    }
                ]
            }],
            behaviorHints: {
                configurable: true,
                configurationURL: `${protocol}://${host}/${req.params.config}/configure`,
                reloadRequired: true
            }
        };

        const builder = new addonBuilder(manifestConfig);

        if (decodedConfig.epg_enabled === 'true') {
            const epgToUse = decodedConfig.epg ||
                (cacheManager.getCachedData().epgUrls && cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',') : null);
            if (epgToUse) await epgManager.initializeEPG(epgToUse);
        }

        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: decodedConfig, cacheManager, epgManager, pythonResolver, pythonRunner }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: decodedConfig, cacheManager, epgManager, pythonResolver, pythonRunner }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: decodedConfig, cacheManager, epgManager, pythonResolver, pythonRunner }));

        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error creating manifest:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route con config in path DEVONO stare prima della route generica :resource/:type/:id
// altrimenti Stremio che chiama /<base64>/catalog/... matcha la generica e usa req.query vuoto → 0 canali
app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);
        const extra = req.params.extra ? safeParseExtra(req.params.extra) : {};

        const result = await catalogHandler({
            type: req.params.type,
            id: req.params.id,
            extra,
            config: decodedConfig,
            cacheManager,
            epgManager,
            pythonResolver,
            pythonRunner
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error handling catalog request:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);

        const result = await streamHandler({
            type: req.params.type,
            id: req.params.id,
            config: decodedConfig,
            cacheManager,
            epgManager,
            pythonResolver,
            pythonRunner
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error handling stream request:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/:config/meta/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);

        const result = await metaHandler({
            type: req.params.type,
            id: req.params.id,
            config: decodedConfig,
            cacheManager,
            epgManager,
            pythonResolver,
            pythonRunner
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error handling meta request:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route generica per catalog/stream/meta (solo URL senza config in path, es. ?m3u=...)
app.get('/:resource/:type/:id/:extra?.json', async (req, res, next) => {
    const { resource, type, id } = req.params;
    const extra = req.params.extra
        ? safeParseExtra(req.params.extra)
        : {};

    try {
        const cacheManager = await getCacheManager(req.query.session_id, req.query);
        const sessionKey = cacheManager.sessionKey;
        const epgManager = await getEPGManager(sessionKey);
        const pythonResolver = getPythonResolver(sessionKey);
        const pythonRunner = getPythonRunner(sessionKey);
        let result;
        switch (resource) {
            case 'stream':
                result = await streamHandler({ type, id, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner });
                break;
            case 'catalog':
                result = await catalogHandler({ type, id, extra, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner });
                break;
            case 'meta':
                result = await metaHandler({ type, id, config: req.query, cacheManager, epgManager, pythonResolver, pythonRunner });
                break;
            default:
                next();
                return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Error handling request:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//route download template
app.get('/api/resolver/download-template', (req, res) => {
    const PythonResolver = require('./src/python-resolver');
    const fs = require('fs');

    try {
        if (fs.existsSync(PythonResolver.scriptPath)) {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', 'attachment; filename="resolver_script.py"');
            res.sendFile(PythonResolver.scriptPath);
        } else {
            res.status(404).json({ success: false, message: 'Template not found. Create it first with "Create Template".' });
        }
    } catch (error) {
        logger.error('_', 'Template download error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

function cleanupTempFolder() {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        return;
    }
    try {
        const files = fs.readdirSync(tempDir);
        let deletedCount = 0;
        for (const file of files) {
            try {
                const filePath = path.join(tempDir, file);
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (fileError) {
                logger.error('_', 'Temp file delete error:', file, fileError.message);
            }
        }
        if (deletedCount > 0) {
            logger.log('_', 'Temp folder cleanup: removed', deletedCount, 'file(s)');
        }
    } catch (error) {
        logger.error('_', 'Temp folder cleanup error:', error.message);
    }
}

function safeParseExtra(extraParam) {
    try {
        if (!extraParam) return {};

        const decodedExtra = decodeURIComponent(extraParam);

        // Supporto per skip con genere
        if (decodedExtra.includes('genre=') && decodedExtra.includes('&skip=')) {
            const parts = decodedExtra.split('&');
            const genre = parts.find(p => p.startsWith('genre=')).split('=')[1];
            const skip = parts.find(p => p.startsWith('skip=')).split('=')[1];

            return {
                genre,
                skip: parseInt(skip, 10) || 0
            };
        }

        if (decodedExtra.startsWith('skip=')) {
            return { skip: parseInt(decodedExtra.split('=')[1], 10) || 0 };
        }

        if (decodedExtra.startsWith('genre=')) {
            return { genre: decodedExtra.split('=')[1] };
        }

        if (decodedExtra.startsWith('search=')) {
            return { search: decodedExtra.split('=')[1] };
        }

        try {
            return JSON.parse(decodedExtra);
        } catch {
            return {};
        }
    } catch (error) {
        logger.error('_', 'Error parsing extra:', error.message);
        return {};
    }
}

// Route per servire il file M3U generato (opzionale session_key in query per sessione)
app.get('/generated-m3u', (req, res) => {
    const sessionKey = req.query.session_key || '_default';
    touchSession(sessionKey);
    const runner = getPythonRunner(sessionKey);
    const m3uContent = runner.getM3UContent();
    if (m3uContent) {
        res.setHeader('Content-Type', 'text/plain');
        res.send(m3uContent);
    } else {
        res.status(404).send('M3U file not found. Run the Python script first.');
    }
});

app.post('/api/resolver', async (req, res) => {
    const { action, url, interval } = req.body;
    const sessionKey = getSessionKeyFromConfig(req.body);
    touchSession(sessionKey);
    const resolver = getPythonResolver(sessionKey);

    try {
        if (action === 'download' && url) {
            const success = await resolver.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Resolver script downloaded successfully' });
            } else {
                res.status(500).json({ success: false, message: resolver.getStatus().lastError });
            }
        } else if (action === 'create-template') {
            const success = await resolver.createScriptTemplate();
            if (success) {
                res.json({
                    success: true,
                    message: 'Resolver script template created successfully',
                    scriptPath: resolver.scriptPath
                });
            } else {
                res.status(500).json({ success: false, message: resolver.getStatus().lastError });
            }
        } else if (action === 'check-health') {
            const isHealthy = await resolver.checkScriptHealth();
            res.json({
                success: isHealthy,
                message: isHealthy ? 'Resolver script valid' : resolver.getStatus().lastError
            });
        } else if (action === 'status') {
            res.json(resolver.getStatus());
        } else if (action === 'clear-cache') {
            resolver.clearCache();
            res.json({ success: true, message: 'Resolver cache cleared' });
        } else if (action === 'schedule' && interval) {
            const success = resolver.scheduleUpdate(interval);
            if (success) {
                res.json({
                    success: true,
                    message: `Auto-update set every ${interval}`
                });
            } else {
                res.status(500).json({ success: false, message: resolver.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = resolver.stopScheduledUpdates();
            res.json({
                success: true,
                message: stopped ? 'Auto-update stopped' : 'No scheduled update to stop'
            });
        } else {
            res.status(400).json({ success: false, message: 'Azione non valida' });
        }
    } catch (error) {
        logger.error(sessionKey, 'Resolver API error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/rebuild-cache', async (req, res) => {
    try {
        const m3uUrl = req.body.m3u;
        if (!m3uUrl) {
            return res.status(400).json({ success: false, message: 'M3U URL required' });
        }

        const cacheManager = await getCacheManager(req.body.session_id, req.body);
        logger.log(cacheManager.sessionKey, 'Rebuild cache requested');
        await cacheManager.rebuildCache(req.body.m3u, req.body);

        if (req.body.epg_enabled === 'true') {
            const epgManager = await getEPGManager(cacheManager.sessionKey);
            const epgToUse = req.body.epg ||
                (cacheManager.getCachedData().epgUrls && cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',')
                    : null);
            if (epgToUse) {
                await epgManager.initializeEPG(epgToUse);
            }
        }

        res.json({ success: true, message: 'Cache and EPG rebuilt successfully' });

    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Rebuild cache error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint API per le operazioni sullo script Python (sessione da body)
app.post('/api/python-script', async (req, res) => {
    const { action, url, interval } = req.body;
    const sessionKey = getSessionKeyFromConfig(req.body);
    touchSession(sessionKey);
    const runner = getPythonRunner(sessionKey);
    const cacheManager = await getCacheManager(req.body?.session_id, req.body || {});

    try {
        if (action === 'download' && url) {
            const success = await runner.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Script downloaded successfully' });
            } else {
                res.status(500).json({ success: false, message: runner.getStatus().lastError });
            }
        } else if (action === 'execute') {
            const success = await runner.executeScript();
            if (success) {
                const m3uUrl = `${req.protocol}://${req.get('host')}/generated-m3u` + (sessionKey !== '_default' ? `?session_key=${encodeURIComponent(sessionKey)}` : '');
                res.json({
                    success: true,
                    message: 'Script executed successfully',
                    m3uUrl
                });
            } else {
                res.status(500).json({ success: false, message: runner.getStatus().lastError });
            }
        } else if (action === 'status') {
            const status = runner.getStatus();
            if (status.m3uExists) {
                status.m3uUrl = `${req.protocol}://${req.get('host')}/generated-m3u` + (sessionKey !== '_default' ? `?session_key=${encodeURIComponent(sessionKey)}` : '');
            }
            res.json(status);
        } else if (action === 'schedule' && interval) {
            const success = runner.scheduleUpdate(interval, cacheManager);
            if (success) {
                res.json({
                    success: true,
                    message: `Auto-update set every ${interval}`
                });
            } else {
                res.status(500).json({ success: false, message: runner.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = runner.stopScheduledUpdates();
            res.json({
                success: true,
                message: stopped ? 'Auto-update stopped' : 'No scheduled update to stop'
            });
        } else {
            res.status(400).json({ success: false, message: 'Azione non valida' });
        }
    } catch (error) {
        logger.error(sessionKey, 'Python script API error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});
async function startAddon() {
    cleanupTempFolder();

    // Inizializza CacheManager di default (per compatibilità e python-runner)
    global.CacheManager = await getCacheManager(null, config);

    // Timer scadenza sessioni: ogni 15 minuti controlla e rimuove sessioni inattive da 24h
    setInterval(cleanupExpiredSessions, 15 * 60 * 1000);
    logger.log('_', 'Session expiry timer active (24h inactivity, check every 15 min)');

    try {
        const port = process.env.PORT || 10000;
        app.listen(port, () => {
            logger.log('_', 'OMG addon started. Config page: http://localhost:' + port);
        });
    } catch (error) {
        logger.error('_', 'Failed to start addon:', error.message);
        process.exit(1);
    }
}

startAddon();
