const fs = require('fs');
const path = require('path');

const baseConfig = {
    port: process.env.PORT || 10000,
    defaultUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    defaultLanguage: 'Italiana',
    cacheSettings: {
        updateInterval: 2 * 60 * 60 * 1000,
        maxAge: 12 * 60 * 60 * 1000,
        retryAttempts: 3,
        retryDelay: 5000
    },
    epgSettings: {
        maxProgramsPerChannel: 50,
        updateInterval: 2 * 60 * 60 * 1000,
        cacheExpiry: 12 * 60 * 60 * 1000
    },
    manifest: {
        id: 'org.mccoy88f.omgtv',
        version: '7.0.0',
        name: 'OMG TV',
        description: 'Modalita provvisoria, installazione con errori, attivo mod. provvisoria',
        logo: 'https://github.com/mccoy88f/OMG-TV-Stremio-Addon/blob/main/tv.png?raw=true',
        resources: ['stream', 'catalog', 'meta'],
        types: ['tv'],
        idPrefixes: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: 'omg_tv',
                name: 'OMG TV',
                extra: [
                    {
                        name: 'genre',
                        isRequired: false,
                        options: []  // Verrà popolato dinamicamente dai generi della playlist
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
            }
        ],
        behaviorHints: {
            configurationURL: null,  // Verrà impostato dinamicamente
            reloadRequired: true
        }
    }
};

function loadCustomConfig() {
    const configOverridePath = path.join(__dirname, '..', 'addon-config.json');
    
    try {
        const addonConfigExists = fs.existsSync(configOverridePath);

        if (addonConfigExists) {
            const customConfig = JSON.parse(fs.readFileSync(configOverridePath, 'utf8'));
            
            const mergedConfig = {
                ...baseConfig,
                defaultLanguage: customConfig.defaultLanguage || baseConfig.defaultLanguage,
                manifest: {
                    ...baseConfig.manifest,
                    id: customConfig.addonId || baseConfig.manifest.id,
                    name: customConfig.addonName || baseConfig.manifest.name,
                    description: customConfig.addonDescription || baseConfig.manifest.description,
                    version: customConfig.addonVersion || baseConfig.manifest.version,
                    logo: customConfig.addonLogo || baseConfig.manifest.logo,
                    behaviorHints: {
                        configurationURL: null,  // Verrà impostato dinamicamente
                        reloadRequired: true
                    },
                    catalogs: [{
                        ...baseConfig.manifest.catalogs[0],
                        id: addonConfigExists ? 'omg_plus_tv' : baseConfig.manifest.catalogs[0].id,
                        name: addonConfigExists ? 'OMG+ TV' : baseConfig.manifest.catalogs[0].name,
                        extra: [
                            {
                                name: 'genre',
                                isRequired: false,
                                options: []  // Verrà popolato dinamicamente dai generi della playlist
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
                    }]
                }
            };

            return mergedConfig;
        }
    } catch (error) {
        console.error('Error loading custom configuration:', error);
    }

    return baseConfig;
}

const config = loadCustomConfig();
module.exports = config;
