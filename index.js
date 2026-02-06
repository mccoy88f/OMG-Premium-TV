const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { addonBuilder } = require('stremio-addon-sdk');
const PlaylistTransformer = require('./playlist-transformer');
const { catalogHandler, streamHandler } = require('./handlers');
const metaHandler = require('./meta-handler');
const EPGManager = require('./epg-manager');
const config = require('./config');
const CacheManagerFactory = require('./cache-manager');
const { renderConfigPage, renderGatePage } = require('./views');
const homeAuth = require('./home-auth');
const PythonRunner = require('./python-runner');
const ResolverStreamManager = require('./resolver-stream-manager')();
const PythonResolver = require('./python-resolver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// Registry cache per sessione (chiave derivata dalla config)
const cacheRegistry = new Map();
async function getCacheManager(sessionId, userConfig) {
    const key = (sessionId && String(sessionId).trim()) ? String(sessionId).trim() : getSessionKeyFromConfig(userConfig);
    if (!cacheRegistry.has(key)) {
        cacheRegistry.set(key, await CacheManagerFactory(userConfig || {}, key === '_default' ? null : key));
    }
    const cm = cacheRegistry.get(key);
    if (userConfig && Object.keys(userConfig).length) cm.updateConfig(userConfig);
    return cm;
}

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

        // Inizializza il generatore Python se configurato
        if (decodedConfig.python_script_url) {
            console.log('Inizializzazione Script Python Generatore dalla configurazione');
            try {
                // Scarica lo script Python se non già scaricato
                await PythonRunner.downloadScript(decodedConfig.python_script_url);

                // Se è stato definito un intervallo di aggiornamento, impostalo
                if (decodedConfig.python_update_interval) {
                    console.log('Impostazione dell\'aggiornamento automatico del generatore Python');
                    PythonRunner.scheduleUpdate(decodedConfig.python_update_interval);
                }
            } catch (pythonError) {
                console.error('Errore nell\'inizializzazione dello script Python:', pythonError);
            }
        }

        const queryWithAuth = { ...decodedConfig, homeAuthEnabled: state.enabled ? 'true' : 'false' };
        res.send(renderConfigPage(protocol, host, queryWithAuth, config.manifest));
    } catch (error) {
        console.error('Errore nella configurazione:', error);
        res.redirect('/');
    }
});

// Route per il manifest - supporta sia il vecchio che il nuovo sistema
app.get('/manifest.json', async (req, res) => {
    try {
        const cacheManager = await getCacheManager(req.query.session_id, req.query);
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configUrl = `${protocol}://${host}/?${new URLSearchParams(req.query)}`;
        if (req.query.resolver_update_interval) {
            configUrl += `&resolver_update_interval=${encodeURIComponent(req.query.resolver_update_interval)}`;
        }
        if (req.query.m3u && cacheManager.cache.m3uUrl !== req.query.m3u) {
            await cacheManager.rebuildCache(req.query.m3u, req.query);
        }

        const { genres } = cacheManager.getCachedData();
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
                configurationURL: configUrl,
                reloadRequired: true
            }
        };
        const builder = new addonBuilder(manifestConfig);

        if (req.query.epg_enabled === 'true') {
            const epgToUse = req.query.epg ||
                (cacheManager.getCachedData().epgUrls &&
                    cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',')
                    : null);

            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }
        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: req.query, cacheManager }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: req.query, cacheManager }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: req.query, cacheManager }));
        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        console.error('Error creating manifest:', error);
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

        if (decodedConfig.m3u && cacheManager.cache.m3uUrl !== decodedConfig.m3u) {
            await cacheManager.rebuildCache(decodedConfig.m3u, decodedConfig);
        }
        if (decodedConfig.resolver_script) {
            console.log('Inizializzazione Script Resolver dalla configurazione');
            try {
                // Scarica lo script Resolver
                const resolverDownloaded = await PythonResolver.downloadScript(decodedConfig.resolver_script);

                // Se è stato definito un intervallo di aggiornamento, impostalo
                if (decodedConfig.resolver_update_interval) {
                    console.log('Impostazione dell\'aggiornamento automatico del resolver');
                    PythonResolver.scheduleUpdate(decodedConfig.resolver_update_interval);
                }
            } catch (resolverError) {
                console.error('Errore nell\'inizializzazione dello script Resolver:', resolverError);
            }
        }
        // Inizializza il generatore Python se configurato
        if (decodedConfig.python_script_url) {
            console.log('Inizializzazione Script Python Generatore dalla configurazione');
            try {
                // Scarica lo script Python se non già scaricato
                await PythonRunner.downloadScript(decodedConfig.python_script_url);

                // Se è stato definito un intervallo di aggiornamento, impostalo
                if (decodedConfig.python_update_interval) {
                    console.log('Impostazione dell\'aggiornamento automatico del generatore Python');
                    PythonRunner.scheduleUpdate(decodedConfig.python_update_interval);
                }
            } catch (pythonError) {
                console.error('Errore nell\'inizializzazione dello script Python:', pythonError);
            }
        }

        const { genres } = cacheManager.getCachedData();
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
                (cacheManager.getCachedData().epgUrls &&
                    cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',')
                    : null);

            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }

        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: decodedConfig, cacheManager }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: decodedConfig, cacheManager }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: decodedConfig, cacheManager }));

        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        console.error('Error creating manifest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Manteniamo la route esistente per gli altri endpoint
app.get('/:resource/:type/:id/:extra?.json', async (req, res, next) => {
    const { resource, type, id } = req.params;
    const extra = req.params.extra
        ? safeParseExtra(req.params.extra)
        : {};

    try {
        const cacheManager = await getCacheManager(req.query.session_id, req.query);
        let result;
        switch (resource) {
            case 'stream':
                result = await streamHandler({ type, id, config: req.query, cacheManager });
                break;
            case 'catalog':
                result = await catalogHandler({ type, id, extra, config: req.query, cacheManager });
                break;
            case 'meta':
                result = await metaHandler({ type, id, config: req.query, cacheManager });
                break;
            default:
                next();
                return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//route download template
app.get('/api/resolver/download-template', (req, res) => {
    const PythonResolver = require('./python-resolver');
    const fs = require('fs');

    try {
        if (fs.existsSync(PythonResolver.scriptPath)) {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', 'attachment; filename="resolver_script.py"');
            res.sendFile(PythonResolver.scriptPath);
        } else {
            res.status(404).json({ success: false, message: 'Template non trovato. Crealo prima con la funzione "Crea Template".' });
        }
    } catch (error) {
        console.error('Errore nel download del template:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

function cleanupTempFolder() {
    console.log('\n=== Pulizia cartella temp all\'avvio ===');
    const tempDir = path.join(__dirname, 'temp');

    // Controlla se la cartella temp esiste
    if (!fs.existsSync(tempDir)) {
        console.log('Cartella temp non trovata, la creo...');
        fs.mkdirSync(tempDir, { recursive: true });
        return;
    }

    try {
        // Leggi tutti i file nella cartella temp
        const files = fs.readdirSync(tempDir);
        let deletedCount = 0;

        // Elimina ogni file
        for (const file of files) {
            try {
                const filePath = path.join(tempDir, file);
                // Controlla se è un file e non una cartella
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (fileError) {
                console.error(`❌ Errore nell'eliminazione del file ${file}:`, fileError.message);
            }
        }

        console.log(`✓ Eliminati ${deletedCount} file temporanei`);
        console.log('=== Pulizia cartella temp completata ===\n');
    } catch (error) {
        console.error('❌ Errore nella pulizia della cartella temp:', error.message);
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
        console.error('Error parsing extra:', error);
        return {};
    }
}

// Per il catalog con config codificato
app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);
        const extra = req.params.extra
            ? safeParseExtra(req.params.extra)
            : {};

        const result = await catalogHandler({
            type: req.params.type,
            id: req.params.id,
            extra,
            config: decodedConfig,
            cacheManager
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling catalog request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Per lo stream con config codificato
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);

        const result = await streamHandler({
            type: req.params.type,
            id: req.params.id,
            config: decodedConfig,
            cacheManager
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling stream request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Per il meta con config codificato
app.get('/:config/meta/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const cacheManager = await getCacheManager(decodedConfig.session_id, decodedConfig);

        const result = await metaHandler({
            type: req.params.type,
            id: req.params.id,
            config: decodedConfig,
            cacheManager
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling meta request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route per servire il file M3U generato
app.get('/generated-m3u', (req, res) => {
    const m3uContent = PythonRunner.getM3UContent();
    if (m3uContent) {
        res.setHeader('Content-Type', 'text/plain');
        res.send(m3uContent);
    } else {
        res.status(404).send('File M3U non trovato. Eseguire prima lo script Python.');
    }
});

app.post('/api/resolver', async (req, res) => {
    const { action, url, interval } = req.body;

    try {
        if (action === 'download' && url) {
            const success = await PythonResolver.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Script resolver scaricato con successo' });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'create-template') {
            const success = await PythonResolver.createScriptTemplate();
            if (success) {
                res.json({
                    success: true,
                    message: 'Template script resolver creato con successo',
                    scriptPath: PythonResolver.scriptPath
                });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'check-health') {
            const isHealthy = await PythonResolver.checkScriptHealth();
            res.json({
                success: isHealthy,
                message: isHealthy ? 'Script resolver valido' : PythonResolver.getStatus().lastError
            });
        } else if (action === 'status') {
            res.json(PythonResolver.getStatus());
        } else if (action === 'clear-cache') {
            PythonResolver.clearCache();
            res.json({ success: true, message: 'Cache resolver svuotata' });
        } else if (action === 'schedule' && interval) {
            const success = PythonResolver.scheduleUpdate(interval);
            if (success) {
                res.json({
                    success: true,
                    message: `Aggiornamento automatico impostato ogni ${interval}`
                });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = PythonResolver.stopScheduledUpdates();
            res.json({
                success: true,
                message: stopped ? 'Aggiornamento automatico fermato' : 'Nessun aggiornamento pianificato da fermare'
            });
        } else {
            res.status(400).json({ success: false, message: 'Azione non valida' });
        }
    } catch (error) {
        console.error('Errore API Resolver:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/rebuild-cache', async (req, res) => {
    try {
        const m3uUrl = req.body.m3u;
        if (!m3uUrl) {
            return res.status(400).json({ success: false, message: 'URL M3U richiesto' });
        }

        const cacheManager = await getCacheManager(req.body.session_id, req.body);
        console.log('🔄 Richiesta di ricostruzione cache ricevuta');
        await cacheManager.rebuildCache(req.body.m3u, req.body);

        if (req.body.epg_enabled === 'true') {
            console.log('📡 Ricostruzione EPG in corso...');
            const epgToUse = req.body.epg ||
                (cacheManager.getCachedData().epgUrls && cacheManager.getCachedData().epgUrls.length > 0
                    ? cacheManager.getCachedData().epgUrls.join(',')
                    : null);
            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }

        res.json({ success: true, message: 'Cache e EPG ricostruiti con successo' });

    } catch (error) {
        console.error('Errore nella ricostruzione della cache:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint API per le operazioni sullo script Python
app.post('/api/python-script', async (req, res) => {
    const { action, url, interval } = req.body;

    try {
        if (action === 'download' && url) {
            const success = await PythonRunner.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Script scaricato con successo' });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'execute') {
            const success = await PythonRunner.executeScript();
            if (success) {
                res.json({
                    success: true,
                    message: 'Script eseguito con successo',
                    m3uUrl: `${req.protocol}://${req.get('host')}/generated-m3u`
                });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'status') {
            res.json(PythonRunner.getStatus());
        } else if (action === 'schedule' && interval) {
            const success = PythonRunner.scheduleUpdate(interval);
            if (success) {
                res.json({
                    success: true,
                    message: `Aggiornamento automatico impostato ogni ${interval}`
                });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = PythonRunner.stopScheduledUpdates();
            res.json({
                success: true,
                message: stopped ? 'Aggiornamento automatico fermato' : 'Nessun aggiornamento pianificato da fermare'
            });
        } else {
            res.status(400).json({ success: false, message: 'Azione non valida' });
        }
    } catch (error) {
        console.error('Errore API Python:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
async function startAddon() {
    cleanupTempFolder();

    // Inizializza CacheManager di default (per compatibilità e python-runner)
    global.CacheManager = await getCacheManager(null, config);

    try {
        const port = process.env.PORT || 10000;
        app.listen(port, () => {
            console.log('=============================\n');
            console.log('OMG ADDON Avviato con successo');
            console.log('Visita la pagina web per generare la configurazione del manifest e installarla su stremio');
            console.log('Link alla pagina di configurazione:', `http://localhost:${port}`);
            console.log('=============================\n');
        });
    } catch (error) {
        console.error('Failed to start addon:', error);
        process.exit(1);
    }
}

startAddon();
