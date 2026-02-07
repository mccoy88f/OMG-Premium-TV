const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const cron = require('node-cron');
const crypto = require('crypto');
const logger = require('./logger');

function safeRunnerNames(sessionKey) {
    if (!sessionKey || sessionKey === '_default') {
        return {
            scriptPath: path.join(__dirname, '..', 'temp_script.py'),
            m3uOutputPath: path.join(__dirname, '..', 'generated_playlist.m3u')
        };
    }
    const hash = crypto.createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 16);
    const tempDir = path.join(__dirname, '..', 'temp');
    return {
        scriptPath: path.join(tempDir, `script_${hash}.py`),
        m3uOutputPath: path.join(tempDir, `generated_${hash}.m3u`)
    };
}

class PythonRunner {
    constructor(sessionKey = null) {
        this.sessionKey = sessionKey;
        const paths = safeRunnerNames(sessionKey);
        this.scriptPath = paths.scriptPath;
        this.m3uOutputPath = paths.m3uOutputPath;
        this.lastExecution = null;
        this.lastError = null;
        this.isRunning = false;
        this.scriptUrl = null;
        this.cronJob = null;
        this.updateInterval = null;
        this._cacheManagerRef = null;

        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    }

    /**
     * Scarica lo script Python dall'URL fornito
     * @param {string} url - L'URL dello script Python
     * @returns {Promise<boolean>} - true se il download è avvenuto con successo
     */
    async downloadScript(url) {
        try {
            this.scriptUrl = url;
            const response = await axios.get(url, { responseType: 'text' });
            fs.writeFileSync(this.scriptPath, response.data);
            logger.log(this.sessionKey, 'Python script downloaded');
            return true;
        } catch (error) {
            logger.error(this.sessionKey, 'Python script download error:', error.message);
            this.lastError = `Errore download: ${error.message}`;
            return false;
        }
    }

    /**
     * Esegue lo script Python scaricato
     * @returns {Promise<boolean>} - true se l'esecuzione è avvenuta con successo
     */
    async executeScript() {
        if (this.isRunning) {
            logger.log(this.sessionKey, 'Python script already running, skip');
            return false;
        }

        if (!fs.existsSync(this.scriptPath)) {
            logger.error(this.sessionKey, 'Python script not found, run downloadScript first');
            this.lastError = 'Script Python non trovato';
            return false;
        }

        try {
            this.isRunning = true;

            // Elimina eventuali file M3U esistenti prima dell'esecuzione
            this.cleanupM3UFiles();

            // Controlla se Python è installato
            await execAsync('python3 --version').catch(() =>
                execAsync('python --version')
            );

            // Esegui lo script Python
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const { stdout, stderr } = await execAsync(`${pythonCmd} ${this.scriptPath}`);

            if (stderr) {
                logger.warn(this.sessionKey, 'Python script stderr:', stderr.slice(0, 200));
            }

            // Cerca qualsiasi file M3U/M3U8 generato e rinominalo
            const foundFiles = this.findAllM3UFiles();

            if (foundFiles.length > 0) {
                logger.log(this.sessionKey, 'Found', foundFiles.length, 'M3U file(s)');

                // Prendi il primo file trovato e rinominalo
                const sourcePath = foundFiles[0];

                // Se il file destinazione esiste già, eliminalo
                if (fs.existsSync(this.m3uOutputPath)) {
                    fs.unlinkSync(this.m3uOutputPath);
                }

                // Rinomina o copia il file
                if (sourcePath !== this.m3uOutputPath) {
                    fs.copyFileSync(sourcePath, this.m3uOutputPath);
                    logger.log(this.sessionKey, 'M3U file copied to', this.m3uOutputPath);

                    // Opzionale: elimina il file originale dopo la copia
                    // fs.unlinkSync(sourcePath);
                }

                this.lastExecution = new Date();
                this.lastError = null;
                this.isRunning = false;
                return true;
            } else {
                // Prova a cercare percorsi nel testo dell'output
                const possiblePath = this.findM3UPathFromOutput(stdout);
                if (possiblePath && fs.existsSync(possiblePath)) {
                    fs.copyFileSync(possiblePath, this.m3uOutputPath);
                    logger.log(this.sessionKey, 'M3U file found and copied');
                    this.lastExecution = new Date();
                    this.lastError = null;
                    this.isRunning = false;
                    return true;
                }

                logger.error(this.sessionKey, 'No M3U file found after script execution');
                this.lastError = 'File M3U non generato dallo script';
                this.isRunning = false;
                return false;
            }
        } catch (error) {
            logger.error(this.sessionKey, 'Python script execution error:', error.message);
            this.lastError = `Errore esecuzione: ${error.message}`;
            this.isRunning = false;
            return false;
        }
    }

    /**
     * Imposta un aggiornamento automatico dello script con la pianificazione specificata
     * @param {string} timeFormat - Formato orario "HH:MM" o "H:MM"
     * @returns {boolean} - true se la pianificazione è stata impostata con successo
     */
    scheduleUpdate(timeFormat, cacheManager = null) {
        this._cacheManagerRef = cacheManager || global.CacheManager;
        this.stopScheduledUpdates();

        if (!timeFormat || !/^\d{1,2}:\d{2}$/.test(timeFormat)) {
            logger.error(this.sessionKey, 'Invalid time format, use HH:MM or H:MM');
            this.lastError = 'Formato orario non valido. Usa HH:MM o H:MM';
            return false;
        }

        try {
            const [hours, minutes] = timeFormat.split(':').map(Number);

            if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                logger.error(this.sessionKey, 'Invalid time, hours: 0-23, minutes: 0-59');
                this.lastError = 'Orario non valido. Ore: 0-23, Minuti: 0-59';
                return false;
            }

            let cronExpression;
            if (hours === 0) {
                cronExpression = `*/${minutes} * * * *`;
                logger.log(this.sessionKey, 'Schedule set: every', minutes, 'min');
            } else {
                cronExpression = `${minutes} */${hours} * * *`;
                logger.log(this.sessionKey, 'Schedule set: every', hours, 'h', minutes, 'min');
            }

            const cacheRef = this._cacheManagerRef;
            this.cronJob = cron.schedule(cronExpression, async () => {
                logger.log(this.sessionKey, 'Scheduled Python script run');
                const success = await this.executeScript();

                if (success && cacheRef) {
                    try {
                        const currentM3uUrl = cacheRef.cache && cacheRef.cache.m3uUrl;
                        if (currentM3uUrl) {
                            logger.log(this.sessionKey, 'Rebuilding cache after scheduled run');
                            await cacheRef.rebuildCache(currentM3uUrl);
                            logger.log(this.sessionKey, 'Cache rebuilt after scheduled run');
                        }
                    } catch (cacheError) {
                        logger.error(this.sessionKey, 'Cache rebuild after scheduled run failed:', cacheError.message);
                    }
                }
            });

            this.updateInterval = timeFormat;
            logger.log(this.sessionKey, 'Auto-update configured:', timeFormat);
            return true;
        } catch (error) {
            logger.error(this.sessionKey, 'Schedule error:', error.message);
            this.lastError = `Errore nella pianificazione: ${error.message}`;
            return false;
        }
    }

    /**
     * Ferma gli aggiornamenti pianificati
     */
    stopScheduledUpdates() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            this.updateInterval = null;
            logger.log(this.sessionKey, 'Auto-update stopped');
            return true;
        }
        return false;
    }

    /**
     * Elimina eventuali file M3U/M3U8 esistenti
     */

    cleanupM3UFiles() {
        try {
            // Trova tutti i file M3U e M3U8 nella directory
            const projectRoot = path.join(__dirname, '..');
            const dirFiles = fs.readdirSync(projectRoot);
            const m3uFiles = dirFiles.filter(file =>
                file.endsWith('.m3u') || file.endsWith('.m3u8')
            );

            // Elimina ogni file M3U/M3U8 trovato
            m3uFiles.forEach(file => {
                const fullPath = path.join(projectRoot, file);
                try {
                    fs.unlinkSync(fullPath);
                    logger.log(this.sessionKey, 'Temp file removed:', fullPath);
                } catch (e) {
                    logger.error(this.sessionKey, 'Temp file delete error:', e.message);
                }
            });

            logger.log(this.sessionKey, 'M3U cleanup: removed', m3uFiles.length, 'file(s)');
        } catch (error) {
            logger.error(this.sessionKey, 'M3U cleanup error:', error.message);
        }
    }
    /**
     * Trova tutti i file M3U o M3U8 nella directory
     * @returns {string[]} - Array di percorsi dei file M3U trovati
     */
    findAllM3UFiles() {
        try {
            const projectRoot = path.join(__dirname, '..');
            const dirFiles = fs.readdirSync(projectRoot);
            return dirFiles
                .filter(file => file.endsWith('.m3u') || file.endsWith('.m3u8'))
                .map(file => path.join(projectRoot, file));
        } catch (error) {
            logger.error(this.sessionKey, 'M3U file search error:', error.message);
            return [];
        }
    }

    /**
     * Cerca un percorso di file M3U nell'output dello script
     * @param {string} output - L'output dello script Python
     * @returns {string|null} - Il percorso del file M3U o null se non trovato
     */
    findM3UPathFromOutput(output) {
        // Cerca percorsi che terminano con .m3u o .m3u8
        const m3uPathRegex = /[\w\/\\\.]+\.m3u8?\b/g;
        const matches = output.match(m3uPathRegex);

        if (matches && matches.length > 0) {
            return matches[0];
        }

        return null;
    }

    /**
     * Legge il contenuto del file M3U generato
     * @returns {string|null} - Il contenuto del file M3U o null se non esiste
     */
    // Aggiungi questa funzione al file python-runner.js, subito prima di getM3UContent()

    /**
     * Aggiunge il canale speciale per la rigenerazione della playlist alla fine del file M3U
     * @returns {boolean} - true se l'operazione è avvenuta con successo
     */
    addRegenerateChannel() {
        try {
            if (!fs.existsSync(this.m3uOutputPath)) {
                logger.error(this.sessionKey, 'M3U file not found, cannot add regeneration channel');
                return false;
            }

            logger.log(this.sessionKey, 'Adding regeneration channel to M3U');

            // Leggi il contenuto attuale del file
            const currentContent = fs.readFileSync(this.m3uOutputPath, 'utf8');

            // Prepara l'entry del canale speciale

            const specialChannel = `
#EXTINF:-1 tvg-id="rigeneraplaylistpython" tvg-name="Rigenera Playlist Python" tvg-logo="https://raw.githubusercontent.com/mccoy88f/OMG-TV-Stremio-Addon/refs/heads/main/tv.png" group-title="~SETTINGS~",Rigenera Playlist Python
http://127.0.0.1/regenerate`;

            // Verifica se il canale già esiste nel file
            if (currentContent.includes('tvg-id="rigeneraplaylistpython"')) {
                logger.log(this.sessionKey, 'Regeneration channel already in M3U');
                return true;
            }

            // Aggiungi il canale speciale alla fine del file
            fs.appendFileSync(this.m3uOutputPath, specialChannel);
            logger.log(this.sessionKey, 'Regeneration channel added to M3U');

            return true;
        } catch (error) {
            logger.error(this.sessionKey, 'Add regeneration channel error:', error.message);
            return false;
        }
    }

    // Modifica la funzione executeScript per chiamare addRegenerateChannel
    async executeScript() {
        if (this.isRunning) {
            logger.log(this.sessionKey, 'Python script already running, skip');
            return false;
        }

        if (!fs.existsSync(this.scriptPath)) {
            logger.error(this.sessionKey, 'Python script not found, run downloadScript first');
            this.lastError = 'Script Python non trovato';
            return false;
        }

        try {
            this.isRunning = true;

            // Elimina eventuali file M3U esistenti prima dell'esecuzione
            this.cleanupM3UFiles();

            // Controlla se Python è installato
            await execAsync('python3 --version').catch(() =>
                execAsync('python --version')
            );

            // Esegui lo script Python
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const { stdout, stderr } = await execAsync(`${pythonCmd} ${this.scriptPath}`);

            if (stderr) {
                logger.warn(this.sessionKey, 'Python script stderr:', stderr.slice(0, 200));
            }

            // Cerca qualsiasi file M3U/M3U8 generato e rinominalo
            const foundFiles = this.findAllM3UFiles();

            if (foundFiles.length > 0) {
                logger.log(this.sessionKey, 'Found', foundFiles.length, 'M3U file(s)');

                // Prendi il primo file trovato e rinominalo
                const sourcePath = foundFiles[0];

                // Se il file destinazione esiste già, eliminalo
                if (fs.existsSync(this.m3uOutputPath)) {
                    fs.unlinkSync(this.m3uOutputPath);
                }

                // Rinomina o copia il file
                if (sourcePath !== this.m3uOutputPath) {
                    fs.copyFileSync(sourcePath, this.m3uOutputPath);
                    logger.log(this.sessionKey, 'M3U file copied to', this.m3uOutputPath);

                    // Opzionale: elimina il file originale dopo la copia
                    // fs.unlinkSync(sourcePath);
                }

                // Aggiungi il canale di rigenerazione
                this.addRegenerateChannel();

                this.lastExecution = new Date();
                this.lastError = null;
                this.isRunning = false;
                return true;
            } else {
                // Prova a cercare percorsi nel testo dell'output
                const possiblePath = this.findM3UPathFromOutput(stdout);
                if (possiblePath && fs.existsSync(possiblePath)) {
                    fs.copyFileSync(possiblePath, this.m3uOutputPath);
                    logger.log(this.sessionKey, 'M3U file found and copied');

                    // Aggiungi il canale di rigenerazione
                    this.addRegenerateChannel();

                    this.lastExecution = new Date();
                    this.lastError = null;
                    this.isRunning = false;
                    return true;
                }

                logger.error(this.sessionKey, 'No M3U file found after script execution');
                this.lastError = 'File M3U non generato dallo script';
                this.isRunning = false;
                return false;
            }
        } catch (error) {
            logger.error(this.sessionKey, 'Python script execution error:', error.message);
            this.lastError = `Errore esecuzione: ${error.message}`;
            this.isRunning = false;
            return false;
        }
    }

    getM3UContent() {
        try {
            if (fs.existsSync(this.m3uOutputPath)) {
                return fs.readFileSync(this.m3uOutputPath, 'utf8');
            }

            // Se il file standard non esiste, cerca altri file M3U
            const files = this.findAllM3UFiles();
            if (files.length > 0) {
                return fs.readFileSync(files[0], 'utf8');
            }

            return null;
        } catch (error) {
            logger.error(this.sessionKey, 'M3U file read error:', error.message);
            return null;
        }
    }

    /**
     * Restituisce il percorso del file M3U generato
     * @returns {string} - Il percorso del file M3U
     */
    getM3UPath() {
        return this.m3uOutputPath;
    }

    /**
     * Restituisce lo stato attuale
     * @returns {Object} - Lo stato attuale
     */
    getStatus() {
        const m3uFiles = this.findAllM3UFiles();

        return {
            isRunning: this.isRunning,
            lastExecution: this.lastExecution ? this.formatDate(this.lastExecution) : 'Mai',
            lastError: this.lastError,
            m3uExists: fs.existsSync(this.m3uOutputPath),
            m3uFiles: m3uFiles.length,
            scriptExists: fs.existsSync(this.scriptPath),
            scriptUrl: this.scriptUrl,
            updateInterval: this.updateInterval,
            scheduledUpdates: this.cronJob !== null
        };
    }

    /**
     * Formatta una data in formato italiano
     * @param {Date} date - La data da formattare
     * @returns {string} - La data formattata
     */
    formatDate(date) {
        return date.toLocaleString('it-IT', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

const registry = new Map();
const defaultInstance = new PythonRunner();

function getPythonRunner(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return defaultInstance;
    if (!registry.has(key)) registry.set(key, new PythonRunner(key));
    return registry.get(key);
}

/**
 * Rimuove una sessione runner (cron, script e M3U su disco). Non usare per _default.
 * @param {string} sessionKey
 */
function removeRunnerSession(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return;
    const instance = registry.get(key);
    if (!instance) return;
    try {
        instance.stopScheduledUpdates();
        if (instance.scriptPath && fs.existsSync(instance.scriptPath)) {
            fs.unlinkSync(instance.scriptPath);
        }
        if (instance.m3uOutputPath && fs.existsSync(instance.m3uOutputPath)) {
            fs.unlinkSync(instance.m3uOutputPath);
        }
        logger.log(key, 'Runner session removed');
    } catch (e) {
        logger.error(key, 'Runner session removal error:', e.message);
    }
    registry.delete(key);
}

module.exports = defaultInstance;
module.exports.getPythonRunner = getPythonRunner;
module.exports.removeRunnerSession = removeRunnerSession;
