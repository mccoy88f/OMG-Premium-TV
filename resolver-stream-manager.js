const config = require('./config');
const PythonResolver = require('./python-resolver');

class ResolverStreamManager {
    constructor() {
        this.resolverCache = new Map();
        this.lastCheck = new Map();
        this.CACHE_DURATION = 20 * 60 * 1000; 
    }

    /**
     * Verifica se il resolver è configurato correttamente
     * @param {Object} userConfig - Configurazione utente
     * @returns {Boolean} - true se il resolver è configurato
     */
    isResolverConfigured(userConfig) {
        return userConfig.resolver_enabled === 'true' && userConfig.resolver_script;
    }

    /**
     * Inizializza il resolver Python
     * @param {Object} userConfig - Configurazione utente
     * @returns {Promise<Boolean>} - true se l'inizializzazione è avvenuta con successo
     */
    async initializeResolver(userConfig) {
        if (!this.isResolverConfigured(userConfig)) {
            return false;
        }

        try {
            const resolverScriptUrl = userConfig.resolver_script;
            
            // Se l'URL è già stato impostato, non scaricare di nuovo lo script
            if (PythonResolver.scriptUrl === resolverScriptUrl) {
                // Verifica che lo script sia funzionante
                const isHealthy = await PythonResolver.checkScriptHealth();
                return isHealthy;
            }
            
            // Scarica lo script
            const downloaded = await PythonResolver.downloadScript(resolverScriptUrl);
            if (!downloaded) {
                console.error('❌ Errore nel download dello script resolver');
                return false;
            }
            
            // Verifica la salute dello script
            const isHealthy = await PythonResolver.checkScriptHealth();
            if (!isHealthy) {
                console.error('❌ Script resolver non valido');
                return false;
            }
            
            // Imposta l'aggiornamento automatico se configurato
            if (userConfig.resolver_update_interval) {
                PythonResolver.scheduleUpdate(userConfig.resolver_update_interval);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Errore nell\'inizializzazione del resolver:', error.message);
            return false;
        }
    }

    /**
     * Verifica se l'URL risolto è valido (non è uguale all'originale e non contiene errori)
     * @param {String} originalUrl - URL originale
     * @param {String} resolvedUrl - URL risolto
     * @returns {Boolean} - true se l'URL risolto è valido
     */
    isValidResolvedUrl(originalUrl, resolvedUrl) {
        // Se l'URL risolto è uguale all'originale, non è stato effettivamente risolto
        if (resolvedUrl === originalUrl) {
            return false;
        }
        
        // Verifica la presenza di errori nell'URL risolto
        const errorPatterns = [
            '500 Server Error', 
            'Internal Server Error',
            'Error 404',
            'Not Found',
            'Service Unavailable'
        ];
        
        for (const pattern of errorPatterns) {
            if (resolvedUrl.includes(pattern)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Ottiene gli stream risolti
     * @param {Object} input - Oggetto con i dettagli dello stream
     * @param {Object} userConfig - Configurazione utente
     * @returns {Promise<Array>} - Array di stream risolti
     */
    async getResolvedStreams(input, userConfig = {}) {
        if (!this.isResolverConfigured(userConfig)) {
            console.log('Resolver non configurato per:', input.name);
            return [];
        }

        let streams = [];

        try {
            // Inizializza il resolver se necessario
            await this.initializeResolver(userConfig);
            
            // Prepara la configurazione del proxy se disponibile
            let proxyConfig = null;
            if (userConfig.proxy && userConfig.proxy_pwd) {
                proxyConfig = {
                    url: userConfig.proxy,
                    password: userConfig.proxy_pwd
                };
            }
            
            // Determiniamo se stiamo ricevendo un channel o uno streamDetails
            const isChannel = input.streamInfo?.urls;
            const streamsList = isChannel ? input.streamInfo.urls : [input];

            // Creiamo array di promesse per elaborazione parallela
            const streamPromises = streamsList.map(async stream => {
                try {
                    // Assicuriamoci di avere degli headers validi con user agent
                    const headers = stream.headers || {};
                    if (!headers['User-Agent'] && !headers['user-agent']) {
                        headers['User-Agent'] = config.defaultUserAgent;
                    }

                    const streamDetails = {
                        name: stream.name || input.name,
                        url: stream.url,
                        headers: headers
                    };
                    // Pulizia degli header prima di inviare al resolver
                    if (streamDetails.headers) {
                        // Rimuovi lo slash finale da referer/referrer
                        if (streamDetails.headers['referer'] || streamDetails.headers['Referer'] || 
                            streamDetails.headers['referrer'] || streamDetails.headers['Referrer']) {
                            const referer = streamDetails.headers['referer'] || streamDetails.headers['Referer'] || 
                                           streamDetails.headers['referrer'] || streamDetails.headers['Referrer'];
                            // Rimuovi lo slash finale se presente
                            streamDetails.headers['Referer'] = referer;
                        }
                    
                        // Rimuovi lo slash finale da origin
                        if (streamDetails.headers['origin'] || streamDetails.headers['Origin']) {
                            const origin = streamDetails.headers['origin'] || streamDetails.headers['Origin'];
                            // Rimuovi lo slash finale se presente
                            streamDetails.headers['Origin'] = origin;
                        }
                    }
                    // Risolvi l'URL tramite lo script Python
                    const result = await PythonResolver.resolveLink(
                        streamDetails.url, 
                        streamDetails.headers,
                        isChannel ? input.name : input.originalName || input.name,
                        proxyConfig
                    );

                    // Se la risoluzione non produce un risultato, restituisci null
                    if (!result || !result.resolved_url) {
                        console.log(`❌ Nessun risultato dal resolver per: ${streamDetails.name}`);
                        return null;
                    }
                    
                    // Se l'URL è lo stesso (non è stato processato dal resolver perché non è Vavoo),
                    // restituisci comunque uno stream con l'URL originale
                    if (result.resolved_url === streamDetails.url) {
                        console.log(`ℹ️ URL non modificato dal resolver per: ${streamDetails.name}, lo manteniamo`);
                        return {
                            name: `${input.originalName}`,
                            title: `📺 ${streamDetails.name}`,
                            url: streamDetails.url,
                            headers: streamDetails.headers,
                            behaviorHints: {
                                notWebReady: false,
                                bingeGroup: "tv"
                            }
                        };
                    }
                    

                    return {
                        name: `${input.originalName}`,
                        title: `🧩 ${streamDetails.name}\n[Resolved]`,
                        url: result.resolved_url,
                        headers: result.headers || streamDetails.headers,
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    };
                } catch (error) {
                    console.error('Errore elaborazione stream:', error.message);
                    return null; // Restituisci null per escludere questo stream
                }
            });

            // Attendiamo tutte le promesse in parallelo
            const results = await Promise.all(streamPromises);
            
            // Filtriamo i risultati escludendo i valori null
            streams = results.filter(item => item !== null);

            
            // Ritorniamo solo gli stream risolti, senza proxy
            return streams;

        } catch (error) {
            console.error('Errore generale resolver:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Headers:', error.response.headers);
            }
            return [];
        }
    }

    /**
     * Cancella la cache del resolver
     */
    clearCache() {
        PythonResolver.clearCache();
    }

    /**
     * Ottiene lo stato del resolver
     * @returns {Object} - Stato del resolver
     */
    getStatus() {
        return PythonResolver.getStatus();
    }
}

module.exports = () => new ResolverStreamManager();
