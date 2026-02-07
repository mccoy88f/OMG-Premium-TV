const config = require('./config');
const PythonResolver = require('./python-resolver');
const logger = require('./logger');

function getLanguageFromConfig(userConfig) {
    return userConfig.language || config.defaultLanguage || 'Italiano';
}

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
    async initializeResolver(userConfig, pythonResolverInstance = null, sessionKey = null) {
        const sk = sessionKey || '_';
        const resolver = pythonResolverInstance || PythonResolver;
        if (!this.isResolverConfigured(userConfig)) {
            return false;
        }

        try {
            const resolverScriptUrl = userConfig.resolver_script;
            if (resolver.scriptUrl === resolverScriptUrl) {
                const isHealthy = await resolver.checkScriptHealth();
                return isHealthy;
            }
            const downloaded = await resolver.downloadScript(resolverScriptUrl);
            if (!downloaded) {
                logger.error(sk, 'Resolver script download error');
                return false;
            }
            const isHealthy = await resolver.checkScriptHealth();
            if (!isHealthy) {
                logger.error(sk, 'Resolver script invalid');
                return false;
            }
            if (userConfig.resolver_update_interval) {
                resolver.scheduleUpdate(userConfig.resolver_update_interval);
            }
            return true;
        } catch (error) {
            logger.error(sk, 'Resolver init error:', error.message);
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
    async getResolvedStreams(input, userConfig = {}, pythonResolverInstance = null, sessionKey = null) {
        const sk = sessionKey || '_';
        const resolver = pythonResolverInstance || PythonResolver;
        if (!this.isResolverConfigured(userConfig)) {
            logger.log(sk, 'Resolver not configured for:', input.name);
            return [];
        }

        let streams = [];

        try {
            await this.initializeResolver(userConfig, resolver, sessionKey);
            
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
                    const result = await resolver.resolveLink(
                        streamDetails.url, 
                        streamDetails.headers,
                        isChannel ? input.name : input.originalName || input.name,
                        proxyConfig
                    );

                    // Se la risoluzione non produce un risultato, restituisci null
                    if (!result || !result.resolved_url) {
                        logger.log(sk, 'No result from resolver for:', streamDetails.name);
                        return null;
                    }
                    
                    const language = getLanguageFromConfig(userConfig);
                    // Se l'URL è lo stesso (non è stato processato dal resolver perché non è Vavoo),
                    // restituisci comunque uno stream con l'URL originale
                    if (result.resolved_url === streamDetails.url) {
                        logger.log(sk, 'URL unchanged by resolver for:', streamDetails.name, ', keeping it');
                        return {
                            name: `${input.originalName}`,
                            title: `📺 ${streamDetails.name} [${language.substring(0, 3).toUpperCase()}]`,
                            url: streamDetails.url,
                            headers: streamDetails.headers,
                            language: language,
                            behaviorHints: {
                                notWebReady: false,
                                bingeGroup: "tv"
                            }
                        };
                    }
                    

                    return {
                        name: `${input.originalName}`,
                        title: `🧩 ${streamDetails.name} [${language.substring(0, 3).toUpperCase()}]\n[Resolved]`,
                        url: result.resolved_url,
                        headers: result.headers || streamDetails.headers,
                        language: language,
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    };
                } catch (error) {
                    logger.error(sk, 'Stream processing error:', error.message);
                    return null;
                }
            });

            // Attendiamo tutte le promesse in parallelo
            const results = await Promise.all(streamPromises);
            
            // Filtriamo i risultati escludendo i valori null
            streams = results.filter(item => item !== null);

            
            // Ritorniamo solo gli stream risolti, senza proxy
            return streams;

        } catch (error) {
            logger.error(sk, 'Resolver error:', error.message);
            if (error.response) {
                logger.error(sk, 'Status:', error.response.status);
                logger.error(sk, 'Headers:', error.response.headers);
            }
            return [];
        }
    }

    /**
     * Cancella la cache del resolver
     */
    clearCache(pythonResolverInstance = null) {
        (pythonResolverInstance || PythonResolver).clearCache();
    }

    getStatus(pythonResolverInstance = null) {
        return (pythonResolverInstance || PythonResolver).getStatus();
    }
}

module.exports = () => new ResolverStreamManager();
