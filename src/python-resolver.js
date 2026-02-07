const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const cron = require('node-cron');
const crypto = require('crypto');
const logger = require('./logger');

function safeResolverScriptName(sessionKey) {
    if (!sessionKey || sessionKey === '_default') return 'resolver_script.py';
    const hash = crypto.createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 16);
    return path.join(__dirname, '..', 'temp', `resolver_${hash}.py`);
}

class PythonResolver {
    constructor(sessionKey = null) {
        this.sessionKey = sessionKey;
        this.scriptPath = sessionKey ? safeResolverScriptName(sessionKey) : path.join(__dirname, '..', 'resolver_script.py');
        this.resolvedLinksCache = new Map();
        this.cacheExpiryTime = 20 * 60 * 1000; // 20 minuti di cache per i link risolti
        this.lastExecution = null;
        this.lastError = null;
        this.isRunning = false;
        this.scriptUrl = null;
        this.cronJob = null;
        this.updateInterval = null;
        this.pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    }

    /**
     * Scarica lo script Python resolver dall'URL fornito
     * @param {string} url - L'URL dello script Python
     * @returns {Promise<boolean>} - true se il download è avvenuto con successo
     */
    async downloadScript(url) {
        try {
            this.scriptUrl = url;
            const response = await axios.get(url, { responseType: 'text' });
            fs.writeFileSync(this.scriptPath, response.data);
            if (!response.data.includes('def resolve_link') && !response.data.includes('def resolve_stream')) {
                this.lastError = 'Script must define resolve_link or resolve_stream';
                logger.error(this.sessionKey, this.lastError);
                return false;
            }
            logger.log(this.sessionKey, 'Resolver script downloaded');
            return true;
        } catch (error) {
            logger.error(this.sessionKey, 'Resolver script download error:', error.message);
            this.lastError = `Errore download: ${error.message}`;
            return false;
        }
    }

    /**
     * Verifica la salute dello script resolver
     * @returns {Promise<boolean>} - true se lo script è valido
     */
    async checkScriptHealth() {
        if (!fs.existsSync(this.scriptPath)) {
            logger.error(this.sessionKey, 'Resolver script not found');
            this.lastError = 'Script Python resolver non trovato';
            return false;
        }

        try {
            // Verifica che Python sia installato
            await execAsync(`${this.pythonCmd} --version`);
            
            // Esegui lo script con il parametro --check per verificare la validità
            const { stdout, stderr } = await execAsync(`${this.pythonCmd} ${this.scriptPath} --check`);
            
            if (stderr && !stderr.includes('resolver_ready')) {
                logger.warn(this.sessionKey, 'Resolver check stderr:', stderr.slice(0, 200));
            }
            return stdout.includes('resolver_ready') || stderr.includes('resolver_ready');
        } catch (error) {
            logger.error(this.sessionKey, 'Resolver script check error:', error.message);
            this.lastError = `Errore verifica: ${error.message}`;
            return false;
        }
    }


    /**
     * Risolve un URL tramite lo script Python
     * @param {string} url - L'URL da risolvere
     * @param {object} headers - Gli header da passare allo script
     * @param {string} channelName - Nome del canale (per logging)
     * @param {object} proxyConfig - Configurazione del proxy (opzionale)
     * @returns {Promise<object>} - Oggetto con l'URL risolto e gli header
     */
    async resolveLink(url, headers = {}, channelName = 'unknown', proxyConfig = null) {
        // Controllo della cache
        const cacheKey = `${url}:${JSON.stringify(headers)}`;
        const cachedResult = this.resolvedLinksCache.get(cacheKey);
        if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheExpiryTime) {
            logger.log(this.sessionKey, 'Using cached URL for:', channelName);
            return cachedResult.data;
        }
    
        if (!fs.existsSync(this.scriptPath)) {
            logger.error(this.sessionKey, 'Resolver script not found');
            this.lastError = 'Script Python resolver non trovato';
            return null;
        }
    
        if (this.isRunning) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    
        try {
            this.isRunning = true;
    
            // Crea un file temporaneo con i parametri di input
            const inputParams = {
                url: url,
                headers: headers,
                channel_name: channelName,
                proxy_config: proxyConfig // Aggiungi la configurazione del proxy
            };
            
            const inputFile = path.join(__dirname, '..', 'temp', `input_${Date.now()}.json`);
            const outputFile = path.join(__dirname, '..', 'temp', `output_${Date.now()}.json`);
            
            fs.writeFileSync(inputFile, JSON.stringify(inputParams, null, 2));
            
            // Esegui lo script Python con i parametri
            const cmd = `${this.pythonCmd} ${this.scriptPath} --resolve "${inputFile}" "${outputFile}"`;
            
            const { stdout, stderr } = await execAsync(cmd);
            
            if (stderr) {
                logger.warn(this.sessionKey, 'Resolver stderr:', stderr.slice(0, 200));
            }
            
            // Leggi il risultato
            if (fs.existsSync(outputFile)) {
                const resultText = fs.readFileSync(outputFile, 'utf8');
                
                try {
                    const result = JSON.parse(resultText);
                    
                    // Salva in cache
                    this.resolvedLinksCache.set(cacheKey, {
                        timestamp: Date.now(),
                        data: result
                    });
                    
                    this.lastExecution = new Date();
                    this.lastError = null;
                    logger.log(this.sessionKey, 'URL resolved for', channelName);
    
    
                    // Elimina i file temporanei
                    try {
                        fs.unlinkSync(inputFile);
                        fs.unlinkSync(outputFile);
                    } catch (e) {
                        logger.error(this.sessionKey, 'Temp file cleanup error:', e.message);
                    }
                    return result;
                    
                } catch (parseError) {
                    logger.error(this.sessionKey, 'Resolver output parse error:', parseError.message);
                    this.lastError = `Errore parsing: ${parseError.message}`;
                    return null;
                }
            } else {
                logger.error(this.sessionKey, 'Resolver output file not created');
                this.lastError = 'File di output non creato';
                return null;
            }
        } catch (error) {
            logger.error(this.sessionKey, 'Resolver error:', error.message);
            this.lastError = `Errore esecuzione: ${error.message}`;
            return null;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Imposta un aggiornamento automatico dello script con la pianificazione specificata
     * @param {string} timeFormat - Formato orario "HH:MM" o "H:MM"
     * @returns {boolean} - true se la pianificazione è stata impostata con successo
     */
    scheduleUpdate(timeFormat) {
        // Ferma eventuali pianificazioni esistenti
        this.stopScheduledUpdates();
        
        // Validazione del formato orario
        if (!timeFormat || !/^\d{1,2}:\d{2}$/.test(timeFormat)) {
            logger.error(this.sessionKey, '[RESOLVER] Invalid time format, use HH:MM or H:MM');
            this.lastError = 'Formato orario non valido. Usa HH:MM o H:MM';
            return false;
        }
        
        try {
            // Estrai ore e minuti
            const [hours, minutes] = timeFormat.split(':').map(Number);
            
            if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                logger.error(this.sessionKey, '[RESOLVER] Invalid time, hours: 0-23, minutes: 0-59');
                this.lastError = 'Orario non valido. Ore: 0-23, Minuti: 0-59';
                return false;
            }
            
            // Crea una pianificazione cron
            let cronExpression;
            
            if (hours === 0) {
                // Esegui ogni X minuti
                cronExpression = `*/${minutes} * * * *`;
                logger.log(this.sessionKey, '[RESOLVER] Schedule set: every', minutes, 'min');
            } else {
                // Esegui ogni X ore
                cronExpression = `${minutes} */${hours} * * *`;
                logger.log(this.sessionKey, '[RESOLVER] Schedule set: every', hours, 'h', minutes, 'min');
            }
            
            this.cronJob = cron.schedule(cronExpression, async () => {
                logger.log(this.sessionKey, '[RESOLVER] Scheduled resolver update');
                if (this.scriptUrl) {
                    await this.downloadScript(this.scriptUrl);
                }
                // Pulisci la cache dopo l'aggiornamento
                this.resolvedLinksCache.clear();
            });
            
            this.updateInterval = timeFormat;
            logger.log(this.sessionKey, '[RESOLVER] Auto-update configured:', timeFormat);
            return true;
        } catch (error) {
            logger.error(this.sessionKey, '[RESOLVER] Schedule error:', error.message);
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
            logger.log(this.sessionKey, 'Resolver auto-update stopped');
            return true;
        }
        return false;
    }

    /**
     * Pulisce la cache dei link risolti
     */
    clearCache() {
        this.resolvedLinksCache.clear();
        logger.log(this.sessionKey, 'Resolver cache cleared');
        return true;
    }

    /**
     * Crea un esempio di script resolver
     * @returns {Promise<boolean>} - true se il template è stato creato con successo
     */
    async createScriptTemplate() {
        try {
            const templateContent = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Python Resolver per OMG TV
# Questo script riceve un URL e restituisce l'URL risolto

import sys
import json
import os
import requests
import time
from urllib.parse import urlparse, parse_qs

# Configurazione globale
API_KEY = "la_tua_api_key"
API_SECRET = "il_tuo_secret"
RESOLVER_VERSION = "1.0.0"

def get_token():
    """
    Esempio di funzione per ottenere un token di autenticazione
    """
    # Implementazione personalizzata per ottenere il token
    # Questa è solo una simulazione
    token = f"token_{int(time.time())}"
    return token

def resolve_link(url, headers=None, channel_name=None):
    """
    Funzione principale che risolve un link
    Parametri:
    - url: URL da risolvere
    - headers: dizionario con gli header HTTP da utilizzare 
    - channel_name: nome del canale per il logging
    
    Restituisce:
    - Un dizionario con l'URL risolto e gli header da utilizzare
    """
    print(f"Risoluzione URL: {url}")
    print(f"Canale: {channel_name}")
    
    # Parsing dell'URL per estrarre parametri
    parsed_url = urlparse(url)
    params = parse_qs(parsed_url.query)
    
    # Esempio: aggiungi un token all'URL
    token = get_token()
    
    # ESEMPIO 1: Aggiungi token a URL esistente
    if parsed_url.netloc == "example.com":
        resolved_url = f"{url}&token={token}"
    
    # ESEMPIO 2: Chiama API e ottieni URL reale
    elif "api" in parsed_url.netloc:
        try:
            api_response = requests.get(
                f"https://api.example.com/resolve",
                params={"url": url, "key": API_KEY},
                headers=headers
            )
            if api_response.status_code == 200:
                data = api_response.json()
                resolved_url = data.get("stream_url", url)
            else:
                print(f"Errore API: {api_response.status_code}")
                resolved_url = url
        except Exception as e:
            print(f"Errore chiamata API: {str(e)}")
            resolved_url = url
    
    # Caso predefinito: restituisci l'URL originale
    else:
        resolved_url = url
    
    # Aggiungi o modifica gli header
    final_headers = headers.copy() if headers else {}
    
    # Puoi aggiungere header specifici
    final_headers["User-Agent"] = final_headers.get("User-Agent", "Mozilla/5.0")
    final_headers["Authorization"] = f"Bearer {token}"
    
    # Restituisci il risultato
    return {
        "resolved_url": resolved_url,
        "headers": final_headers
    }

def main():
    """
    Funzione principale che gestisce i parametri di input
    """
    # Verifica parametri di input
    if len(sys.argv) < 2:
        print("Utilizzo: python3 resolver.py [--check|--resolve input_file output_file]")
        sys.exit(1)
    
    # Comando check: verifica che lo script sia valido
    if sys.argv[1] == "--check":
        print("resolver_ready: True")
        sys.exit(0)
    
    # Comando resolve: risolvi un URL
    if sys.argv[1] == "--resolve" and len(sys.argv) >= 4:
        input_file = sys.argv[2]
        output_file = sys.argv[3]
        
        try:
            # Leggi i parametri di input
            with open(input_file, 'r') as f:
                input_data = json.load(f)
            
            url = input_data.get('url', '')
            headers = input_data.get('headers', {})
            channel_name = input_data.get('channel_name', 'unknown')
            
            # Risolvi l'URL
            result = resolve_link(url, headers, channel_name)
            
            # Scrivi il risultato
            with open(output_file, 'w') as f:
                json.dump(result, f, indent=2)
            
            print(f"URL risolto salvato in: {output_file}")
            sys.exit(0)
        except Exception as e:
            print(f"Errore: {str(e)}")
            sys.exit(1)
    
    print("Comando non valido")
    sys.exit(1)

if __name__ == "__main__":
    main()
`;
            
            fs.writeFileSync(this.scriptPath, templateContent);
            logger.log(this.sessionKey, 'Resolver template created');
            return true;
        } catch (error) {
            logger.error(this.sessionKey, 'Resolver template creation error:', error.message);
            this.lastError = `Errore creazione template: ${error.message}`;
            return false;
        }
    }

    /**
     * Restituisce lo stato attuale del resolver
     * @returns {Object} - Lo stato attuale
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastExecution: this.lastExecution ? this.formatDate(this.lastExecution) : 'Mai',
            lastError: this.lastError,
            scriptExists: fs.existsSync(this.scriptPath),
            scriptUrl: this.scriptUrl,
            updateInterval: this.updateInterval,
            scheduledUpdates: this.cronJob !== null,
            cacheItems: this.resolvedLinksCache.size,
            resolverVersion: this.getResolverVersion()
        };
    }

    /**
     * Ottiene la versione del resolver dallo script Python
     */
    getResolverVersion() {
        try {
            if (fs.existsSync(this.scriptPath)) {
                const content = fs.readFileSync(this.scriptPath, 'utf8');
                const versionMatch = content.match(/RESOLVER_VERSION\s*=\s*["']([^"']+)["']/);
                if (versionMatch && versionMatch[1]) {
                    return versionMatch[1];
                }
            }
            return 'N/A';
        } catch (error) {
            logger.error(this.sessionKey, 'Resolver version read error:', error.message);
            return 'Errore';
        }
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
const defaultInstance = new PythonResolver();

function getPythonResolver(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return defaultInstance;
    if (!registry.has(key)) registry.set(key, new PythonResolver(key));
    return registry.get(key);
}

/**
 * Rimuove una sessione resolver (cron, script su disco). Non usare per _default.
 * @param {string} sessionKey
 */
function removeResolverSession(sessionKey) {
    const key = (sessionKey && String(sessionKey).trim()) ? String(sessionKey).trim() : '_default';
    if (key === '_default') return;
    const instance = registry.get(key);
    if (!instance) return;
    try {
        instance.stopScheduledUpdates();
        if (instance.scriptPath && fs.existsSync(instance.scriptPath)) {
            fs.unlinkSync(instance.scriptPath);
            logger.log(key, 'Resolver session removed:', instance.scriptPath);
        }
        instance.resolvedLinksCache.clear();
    } catch (e) {
        logger.error(key, 'Resolver session removal error:', e.message);
    }
    registry.delete(key);
}

module.exports = defaultInstance;
module.exports.getPythonResolver = getPythonResolver;
module.exports.removeResolverSession = removeResolverSession;
