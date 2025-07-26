const config = require('./config');
const CacheManager = require('./cache-manager')(config);
const EPGManager = require('./epg-manager');
const StreamProxyManager = require('./stream-proxy-manager')(config);
const ResolverStreamManager = require('./resolver-stream-manager')(config);

function getLanguageFromConfig(userConfig) {
    return userConfig.language || config.defaultLanguage || 'Italiana';
}

function normalizeId(id) {
    return id?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
}

function cleanNameForImage(name) {
    // Prima rimuoviamo la data e l'ora se presente (pattern: dd/dd/dd - dd:dd (CET))
    let cleaned = name.replace(/\d{2}\/\d{2}\/\d{2}\s*-\s*\d{2}:\d{2}\s*\(CET\)/g, '').trim();
    
    // Rimuoviamo l'anno se inizia con esso
    cleaned = cleaned.replace(/^20\d{2}\s+/, '');
    
    // Rimuoviamo caratteri speciali mantenendo spazi e trattini
    cleaned = cleaned.replace(/[^a-zA-Z0-9\s-]/g, '');
    
    // Rimuoviamo spazi multipli
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Prendiamo solo la parte principale del nome
    let parts = cleaned.split(' - ');
    if (parts.length > 1) {
        cleaned = parts[0].trim();
    }
    
    // Se ancora troppo lungo, tronchiamo preservando parole intere
    if (cleaned.length > 30) {
        let words = cleaned.split(' ');
        let result = '';
        for (let word of words) {
            if ((result + ' ' + word).length <= 27) {
                result += (result ? ' ' : '') + word;
            } else {
                break;
            }
        }
        cleaned = result + '...';
    }
    
    return cleaned || 'No Name';
}

async function catalogHandler({ type, id, extra, config: userConfig }) {
    try {
        if (!userConfig.m3u) {
            console.log('[Handlers] URL M3U mancante nella configurazione');
            return { metas: [], genres: [] };
        }

        // Aggiorna sempre la configurazione
        await CacheManager.updateConfig(userConfig);

        // Se l'EPG è abilitato, inizializzalo
        if (userConfig.epg_enabled === 'true') {
            const epgToUse = userConfig.epg ||
                (CacheManager.cache.epgUrls && 
                CacheManager.cache.epgUrls.length > 0
                    ? CacheManager.cache.epgUrls.join(',')
                    : null);
                    
            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }

        let { search, genre, skip = 0 } = extra || {};
        
        if (genre && genre.includes('&skip')) {
            const parts = genre.split('&skip');
            genre = parts[0];
            if (parts[1] && parts[1].startsWith('=')) {
                skip = parseInt(parts[1].substring(1)) || 0;
            }
        }

        // Se riceviamo un nuovo filtro (search o genre), lo salviamo
        if (search) {
            CacheManager.setLastFilter('search', search);
        } else if (genre) {
            CacheManager.setLastFilter('genre', genre);
        } else if (!skip) {
            // Se non c'è skip, significa che è una nuova richiesta senza filtri
            CacheManager.clearLastFilter();
        }

        skip = parseInt(skip) || 0;
        const ITEMS_PER_PAGE = 100;
        
        // Otteniamo i canali già filtrati
        let filteredChannels = CacheManager.getFilteredChannels();
        const cachedData = CacheManager.getCachedData();

        const paginatedChannels = filteredChannels.slice(skip, skip + ITEMS_PER_PAGE);

        const metas = paginatedChannels.map(channel => {
            const displayName = cleanNameForImage(channel.name);
            const encodedName = encodeURIComponent(displayName).replace(/%20/g, '+');
            const fallbackLogo = `https://dummyimage.com/500x500/590b8a/ffffff.jpg&text=${encodedName}`;
            const language = getLanguageFromConfig(userConfig);
            const languageAbbr = language.substring(0, 3).toUpperCase();
            
            const meta = {
                id: channel.id,
                type: 'tv',
                name: `${channel.name} [${languageAbbr}]`,
                poster: channel.poster || fallbackLogo,
                background: channel.background || fallbackLogo,
                logo: channel.logo || fallbackLogo,
                description: channel.description || `Canale: ${channel.name} - ID: ${channel.streamInfo?.tvg?.id}`,
                genre: channel.genre,
                posterShape: channel.posterShape || 'square',
                releaseInfo: 'LIVE',
                behaviorHints: {
                    isLive: true,
                    ...channel.behaviorHints
                },
                streamInfo: channel.streamInfo
            };

            if (channel.streamInfo?.tvg?.chno) {
                meta.name = `${channel.streamInfo.tvg.chno}. ${channel.name} [${languageAbbr}]`;
            }

            if ((!meta.poster || !meta.background || !meta.logo) && channel.streamInfo?.tvg?.id) {
                const epgIcon = EPGManager.getChannelIcon(channel.streamInfo.tvg.id);
                if (epgIcon) {
                    meta.poster = meta.poster || epgIcon;
                    meta.background = meta.background || epgIcon;
                    meta.logo = meta.logo || epgIcon;
                }
            }

            return enrichWithEPG(meta, channel.streamInfo?.tvg?.id, userConfig);
        });

        return {
            metas,
            genres: cachedData.genres
        };

    } catch (error) {
        console.error('[Handlers] Errore nella gestione del catalogo:', error);
        return { metas: [], genres: [] };
    }
}

function enrichWithEPG(meta, channelId, userConfig) {
    if (!userConfig.epg_enabled || !channelId) {
        meta.description = `Canale live: ${meta.name}`;
        meta.releaseInfo = 'LIVE';
        return meta;
    }

    const currentProgram = EPGManager.getCurrentProgram(normalizeId(channelId));
    const upcomingPrograms = EPGManager.getUpcomingPrograms(normalizeId(channelId));

    if (currentProgram) {
        meta.description = `IN ONDA ORA:\n${currentProgram.title}`;

        if (currentProgram.description) {
            meta.description += `\n${currentProgram.description}`;
        }

        meta.description += `\nOrario: ${currentProgram.start} - ${currentProgram.stop}`;

        if (currentProgram.category) {
            meta.description += `\nCategoria: ${currentProgram.category}`;
        }

        if (upcomingPrograms && upcomingPrograms.length > 0) {
            meta.description += '\n\nPROSSIMI PROGRAMMI:';
            upcomingPrograms.forEach(program => {
                meta.description += `\n${program.start} - ${program.title}`;
            });
        }

        meta.releaseInfo = `In onda: ${currentProgram.title}`;
    }

    return meta;
}

async function streamHandler({ id, config: userConfig }) {
    try {
        if (!userConfig.m3u) {
            console.log('M3U URL mancante');
            return { streams: [] };
        }

        // Aggiorna sempre la configurazione
        await CacheManager.updateConfig(userConfig);

        const channelId = id.split('|')[1];
        
        // Gestione canale speciale per la rigenerazione playlist
        if (channelId === 'rigeneraplaylistpython') {
            console.log('\n=== Richiesta rigenerazione playlist Python ===');
        
            
            // Esegui lo script Python
            const PythonRunner = require('./python-runner');
            const result = await PythonRunner.executeScript();
            
            if (result) {
                console.log('✓ Script Python eseguito con successo');
                
                // Ricostruisci la cache
                console.log('Ricostruzione cache con il nuovo file generato...');
                await CacheManager.rebuildCache(userConfig.m3u, userConfig);
                
                return { 
                    streams: [{
                        name: 'Completato',
                        title: '✅ Playlist rigenerata con successo!\n Riavvia stremio o torna indietro.',
                        url: 'https://static.vecteezy.com/system/resources/previews/001/803/236/mp4/no-signal-bad-tv-free-video.mp4',
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    }]
                };
            } else {
                console.log('❌ Errore nell\'esecuzione dello script Python');
                return { 
                    streams: [{
                        name: 'Errore',
                        title: `❌ Errore: ${PythonRunner.lastError || 'Errore sconosciuto'}`,
                        url: 'https://static.vecteezy.com/system/resources/previews/001/803/236/mp4/no-signal-bad-tv-free-video.mp4',
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    }]
                };
            }
        }
        
        // Continua con il normale flusso per gli altri canali
        const channel = CacheManager.getChannel(channelId);

        if (!channel) {
            console.log('Canale non trovato:', channelId);
            return { streams: [] };
        }

        let streams = [];
        let originalStreamDetails = [];

        // Prepara i dettagli dello stream originale per potenziale risoluzione o proxy
        if (channel.streamInfo.urls) {
            for (const stream of channel.streamInfo.urls) {
                const headers = stream.headers || {};
                if (!headers['User-Agent']) {
                    headers['User-Agent'] = config.defaultUserAgent;
                }
                
                originalStreamDetails.push({
                    name: channel.name,
                    originalName: stream.name,
                    url: stream.url,
                    headers: headers
                });
            }
        }


        if (userConfig.resolver_enabled === 'true' && userConfig.resolver_script) {
            console.log(`\n=== Utilizzo Resolver per ${channel.name} ===`);
            
            try {
                const streamDetails = {
                    name: channel.name,
                    originalName: channel.name,
                    streamInfo: {
                        urls: channel.streamInfo.urls
                    }
                };
                
                const resolvedStreams = await ResolverStreamManager.getResolvedStreams(streamDetails, userConfig);
                
                if (resolvedStreams && resolvedStreams.length > 0) {
                    console.log(`✓ Ottenuti ${resolvedStreams.length} flussi risolti`);
                    
                    if (userConfig.force_proxy === 'true') {
                        // Se force_proxy è attivo, mostriamo SOLO i flussi passati attraverso il proxy
                        if (userConfig.proxy && userConfig.proxy_pwd) {
                            console.log('⚙️ Applicazione proxy ai flussi risolti (modalità forzata)...');
                            
                            for (const resolvedStream of resolvedStreams) {
                                const proxyStreamDetails = {
                                    name: resolvedStream.name,
                                    originalName: resolvedStream.title,
                                    url: resolvedStream.url,
                                    headers: resolvedStream.headers || {}
                                };
                                
                                const proxiedResolvedStreams = await StreamProxyManager.getProxyStreams(proxyStreamDetails, userConfig);
                                streams.push(...proxiedResolvedStreams);
                            }
                            
                            if (streams.length === 0) {
                                console.log('⚠️ Nessun proxy valido per i flussi risolti e force_proxy è attivo, nessun flusso disponibile');
                            }
                        } else {
                            console.log('⚠️ Proxy forzato ma non configurato correttamente, uso i flussi risolti originali');
                            streams = resolvedStreams;
                        }
                    } else {
                        // Se force_proxy NON è attivo:
                        // 1. Aggiungiamo prima i flussi risolti originali
                        streams = resolvedStreams;
                        
                        // 2. Aggiungiamo anche i flussi risolti tramite proxy, se il proxy è configurato
                        if (userConfig.proxy && userConfig.proxy_pwd) {
                            console.log('⚙️ Aggiunta dei flussi proxy ai flussi risolti...');
                            
                            for (const resolvedStream of resolvedStreams) {
                                const proxyStreamDetails = {
                                    name: resolvedStream.name,
                                    originalName: resolvedStream.title,
                                    url: resolvedStream.url,
                                    headers: resolvedStream.headers || {}
                                };
                                
                                const proxiedResolvedStreams = await StreamProxyManager.getProxyStreams(proxyStreamDetails, userConfig);
                                streams.push(...proxiedResolvedStreams);
                            }
                        }
                    }
                } else {
                    console.log('⚠️ Nessun flusso risolto disponibile, utilizzo flussi standard');
                    // Riprendi con la logica standard solo se il resolver fallisce
                    streams = await processOriginalStreams(originalStreamDetails, channel, userConfig);
                }
            } catch (resolverError) {
                console.error('❌ Errore durante la risoluzione dei flussi:', resolverError);
                // In caso di errore del resolver, riprendi con la logica standard
                streams = await processOriginalStreams(originalStreamDetails, channel, userConfig);
            }
        } else {
            // Usa la logica standard se il resolver non è abilitato
            streams = await processOriginalStreams(originalStreamDetails, channel, userConfig);
        }

        // Aggiungi i metadati a tutti gli stream
        const displayName = cleanNameForImage(channel.name);
        const encodedName = encodeURIComponent(displayName).replace(/%20/g, '+');
        const fallbackLogo = `https://dummyimage.com/500x500/590b8a/ffffff.jpg&text=${encodedName}`;

        const meta = {
            id: channel.id,
            type: 'tv',
            name: channel.name,
            poster: channel.poster || fallbackLogo,
            background: channel.background || fallbackLogo,
            logo: channel.logo || fallbackLogo,
            description: channel.description || `ID Canale: ${channel.streamInfo?.tvg?.id}`,
            genre: channel.genre,
            posterShape: channel.posterShape || 'square',
            releaseInfo: 'LIVE',
            behaviorHints: {
                isLive: true,
                ...channel.behaviorHints
            },
            streamInfo: channel.streamInfo
        };

        if ((!meta.poster || !meta.background || !meta.logo) && channel.streamInfo?.tvg?.id) {
            const epgIcon = EPGManager.getChannelIcon(channel.streamInfo.tvg.id);
            if (epgIcon) {
                meta.poster = meta.poster || epgIcon;
                meta.background = meta.background || epgIcon;
                meta.logo = meta.logo || epgIcon;
            }
        }

        streams.forEach(stream => {
            stream.meta = meta;
        });

        return { streams };
    } catch (error) {
        console.error('Errore stream handler:', error);
        return { streams: [] };
    }
}

// Funzione ausiliaria per processare gli stream originali (codice esistente estratto)
async function processOriginalStreams(originalStreamDetails, channel, userConfig) {
    let streams = [];
    
    if (userConfig.force_proxy === 'true') {
        if (userConfig.proxy && userConfig.proxy_pwd) {
            for (const streamDetails of originalStreamDetails) {
                const proxyStreams = await StreamProxyManager.getProxyStreams(streamDetails, userConfig);
                streams.push(...proxyStreams);
            }
        }
    } else {
        // Aggiungi prima gli stream originali
        for (const streamDetails of originalStreamDetails) {
            const language = getLanguageFromConfig(userConfig);
            const streamMeta = {
                name: streamDetails.name,
                title: `📺 ${streamDetails.originalName || streamDetails.name} [${language.substring(0, 3).toUpperCase()}]`,
                url: streamDetails.url,
                headers: streamDetails.headers,
                language: language,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: "tv"
                }
            };
            streams.push(streamMeta);

            // Aggiungi anche stream proxy se configurato
            if (userConfig.proxy && userConfig.proxy_pwd) {
                const proxyStreams = await StreamProxyManager.getProxyStreams(streamDetails, userConfig);
                streams.push(...proxyStreams);
            }
        }
    }
    
    return streams;
}

module.exports = {
    catalogHandler,
    streamHandler,
    // Esporta anche la nuova funzione ausiliaria per poterla utilizzare in altri moduli se necessario
    processOriginalStreams
};
