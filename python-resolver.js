const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const cron = require('node-cron');

class PythonResolver {
    constructor() {
        this.scriptPath = path.join(__dirname, 'resolver_script.py');
        this.resolvedLinksCache = new Map();
        this.cacheExpiryTime = 20 * 60 * 1000; // 20 minuti di cache per i link risolti
        this.lastExecution = null;
        this.lastError = null;
        this.isRunning = false;
        this.scriptUrl = null;
        this.cronJob = null;
        this.updateInterval = null;
        this.pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        
        // Crea la directory temp se non esiste
        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }
    }

    /**
     * Scarica lo script Python resolver dall'URL fornito
     * @param {string} url - L'URL dello script Python
     * @returns {Promise<boolean>} - true se il download è avvenuto con successo
     */
    async downloadScript(url) {
        try {
            console.log(`\n=== Download script Python resolver da ${url} ===`);
            this.scriptUrl = url;
            
            const response = await axios.get(url, { responseType: 'text' });
            fs.writeFileSync(this.scriptPath, response.data);
            
            // Verifica che lo script contenga la funzione resolve_link
            if (!response.data.includes('def resolve_link') && !response.data.includes('def resolve_stream')) {
                this.lastError = 'Lo script deve contenere una funzione resolve_link o resolve_stream';
                console.error(`❌ ${this.lastError}`);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('❌ Errore durante il download dello script Python resolver:', error.message);
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
            console.error('❌ Script Python resolver non trovato');
            this.lastError = 'Script Python resolver non trovato';
            return false;
        }

        try {
            // Verifica che Python sia installato
            await execAsync(`${this.pythonCmd} --version`);
            
            // Esegui lo script con il parametro --check per verificare la validità
            const { stdout, stderr } = await execAsync(`${this.pythonCmd} ${this.scriptPath} --check`);
            
            if (stderr && !stderr.includes('resolver_ready')) {
                console.warn('⚠️ Warning durante la verifica dello script:', stderr);
            }
            
            return stdout.includes('resolver_ready') || stderr.includes('resolver_ready');
        } catch (error) {
            console.error('❌ Errore durante la verifica dello script resolver:', error.message);
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
            console.log(`✓ Usando URL in cache per: ${channelName}`);
            return cachedResult.data;
        }
    
        if (!fs.existsSync(this.scriptPath)) {
            console.error('❌ Script Python resolver non trovato');
            this.lastError = 'Script Python resolver non trovato';
            return null;
        }
    
        if (this.isRunning) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    
        try {
            this.isRunning = true;
            console.log(`\n=== Risoluzione URL per: ${channelName} ===`);
    
            // Crea un file temporaneo con i parametri di input
            const inputParams = {
                url: url,
                headers: headers,
                channel_name: channelName,
                proxy_config: proxyConfig // Aggiungi la configurazione del proxy
            };
            
            const inputFile = path.join(__dirname, 'temp', `input_${Date.now()}.json`);
            const outputFile = path.join(__dirname, 'temp', `output_${Date.now()}.json`);
            
            fs.writeFileSync(inputFile, JSON.stringify(inputParams, null, 2));
            
            // Esegui lo script Python con i parametri
            const cmd = `${this.pythonCmd} ${this.scriptPath} --resolve "${inputFile}" "${outputFile}"`;
            
            const { stdout, stderr } = await execAsync(cmd);
            
            if (stderr) {
                console.warn('⚠️ Warning durante la risoluzione:', stderr);
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
                    console.log(`✓ URL risolto per ${channelName}`);
    
    
                    // Elimina i file temporanei
                    try {
                        fs.unlinkSync(inputFile);
                        fs.unlinkSync(outputFile);
                    } catch (e) {
                        console.error('Errore nella pulizia dei file temporanei:', e.message);
                    }
                    return result;
                    
                } catch (parseError) {
                    console.error('❌ Errore nel parsing del risultato:', parseError.message);
                    console.error('Contenuto risultato:', resultText);
                    this.lastError = `Errore parsing: ${parseError.message}`;
                    return null;
                }
            } else {
                console.error('❌ File di output non creato');
                this.lastError = 'File di output non creato';
                return null;
            }
        } catch (error) {
            console.error('❌ Errore durante la risoluzione URL:', error.message);
            if (error.stderr) console.error('Stderr:', error.stderr);
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
            console.error('❌ [RESOLVER] Formato orario non valido. Usa HH:MM o H:MM');
            this.lastError = 'Formato orario non valido. Usa HH:MM o H:MM';
            return false;
        }
        
        try {
            // Estrai ore e minuti
            const [hours, minutes] = timeFormat.split(':').map(Number);
            
            if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                console.error('❌ [RESOLVER] Orario non valido. Ore: 0-23, Minuti: 0-59');
                this.lastError = 'Orario non valido. Ore: 0-23, Minuti: 0-59';
                return false;
            }
            
            // Crea una pianificazione cron
            let cronExpression;
            
            if (hours === 0) {
                // Esegui ogni X minuti
                cronExpression = `*/${minutes} * * * *`;
                console.log(`✓ [RESOLVER] Pianificazione impostata: ogni ${minutes} minuti`);
            } else {
                // Esegui ogni X ore
                cronExpression = `${minutes} */${hours} * * *`;
                console.log(`✓ [RESOLVER] Pianificazione impostata: ogni ${hours} ore e ${minutes} minuti`);
            }
            
            this.cronJob = cron.schedule(cronExpression, async () => {
                console.log(`\n=== [RESOLVER] Aggiornamento automatico script resolver (${new Date().toLocaleString()}) ===`);
                if (this.scriptUrl) {
                    await this.downloadScript(this.scriptUrl);
                }
                // Pulisci la cache dopo l'aggiornamento
                this.resolvedLinksCache.clear();
            });
            
            this.updateInterval = timeFormat;
            console.log(`✓ [RESOLVER] Aggiornamento automatico configurato: ${timeFormat}`);
            return true;
        } catch (error) {
            console.error('❌ [RESOLVER] Errore nella pianificazione:', error.message);
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
            console.log('✓ Aggiornamento automatico fermato');
            return true;
        }
        return false;
    }

    /**
     * Pulisce la cache dei link risolti
     */
    clearCache() {
        this.resolvedLinksCache.clear();
        console.log('✓ Cache dei link risolti svuotata');
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
    print(f"Resolving URL: {url}")
    print(f"Channel: {channel_name}")
    
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
            console.log('✓ Template dello script resolver creato con successo');
            return true;
        } catch (error) {
            console.error('❌ Errore nella creazione del template:', error.message);
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
            console.error('Errore nella lettura della versione:', error.message);
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

module.exports = new PythonResolver();
