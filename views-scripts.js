/**
 * Restituisce tutto il codice JavaScript per i controlli della pagina di configurazione
 * @param {string} protocol - Il protocollo HTTP/HTTPS in uso
 * @param {string} host - L'hostname del server
 * @returns {string} - Codice JavaScript da inserire nel template
 */
const getViewScripts = (protocol, host) => {
    return `
        // Funzioni per le sezioni espandibili
        function toggleAdvancedSettings() {
            const content = document.getElementById('advanced-settings-content');
            const toggle = document.getElementById('advanced-settings-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }
        
        function togglePythonSection() {
            const content = document.getElementById('python-section-content');
            const toggle = document.getElementById('python-section-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }
        
        function toggleResolverSection() {
            const content = document.getElementById('resolver-section-content');
            const toggle = document.getElementById('resolver-section-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }

        // Funzioni per la gestione della configurazione
        function getConfigQueryString() {
            const form = document.getElementById('configForm');
            const formData = new FormData(form);
            const params = new URLSearchParams();
            
            formData.forEach((value, key) => {
                if (value || key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled') {
                    if (key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled') {
                        params.append(key, form.elements[key].checked);
                    } else {
                        params.append(key, value);
                    }
                }
            });
            
            return params.toString();
        }

        function showConfirmModal() {
            document.getElementById('confirmModal').style.display = 'flex';
        }

        function cancelInstallation() {
            document.getElementById('confirmModal').style.display = 'none';
        }

        function proceedInstallation() {
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            window.location.href = \`stremio://${host}/\${configBase64}/manifest.json\`;
            document.getElementById('confirmModal').style.display = 'none';
        }

        function installAddon() {
            showConfirmModal();
        }

        function updateConfig(e) {
            e.preventDefault();
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            window.location.href = \`${protocol}://${host}/\${configBase64}/configure\`;
        }

        function copyManifestUrl() {
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            const manifestUrl = \`${protocol}://${host}/\${configBase64}/manifest.json\`;
            
            navigator.clipboard.writeText(manifestUrl).then(() => {
                const toast = document.getElementById('toast');
                toast.style.display = 'block';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 2000);
            });
        }

        function backupConfig() {
            const queryString = getConfigQueryString();
            const params = Object.fromEntries(new URLSearchParams(queryString));
            
            params.epg_enabled = params.epg_enabled === 'true';
            params.force_proxy = params.force_proxy === 'true';
            params.resolver_enabled = params.resolver_enabled === 'true';
            params.resolver_update_interval = 
                document.getElementById('resolverUpdateInterval').value || 
                document.querySelector('input[name="resolver_update_interval"]')?.value || 
                '';
                
            const configBlob = new Blob([JSON.stringify(params, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(configBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'omg_tv_config.json';
            a.click();
            URL.revokeObjectURL(url);
        }

        async function restoreConfig(event) {
            const file = event.target.files[0];
            if (!file) return;
        
            showLoader('Restoring configuration...');
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const config = JSON.parse(e.target.result);
        
                    const form = document.getElementById('configForm');
                    for (const [key, value] of Object.entries(config)) {
                        const input = form.elements[key];
                        if (input) {
                            if (input.type === 'checkbox') {
                                input.checked = value;
                            } else {
                                input.value = value;
                            }
                        }
                    }

                    if (config.resolver_update_interval) {
                        document.getElementById('resolverUpdateInterval').value = config.resolver_update_interval;
                    
                        // Crea un campo nascosto nel form se non esiste già
                        let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                        if (!hiddenField) {
                            hiddenField = document.createElement('input');
                            hiddenField.type = 'hidden';
                            hiddenField.name = 'resolver_update_interval';
                            document.getElementById('configForm').appendChild(hiddenField);
                        }
                        
                        // Imposta il valore nel campo nascosto
                        hiddenField.value = config.resolver_update_interval;
                    
                        // Pianifica l'aggiornamento del resolver
                        await fetch('/api/resolver', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                action: 'schedule',
                                interval: config.resolver_update_interval
                            })
                        });
                    }
                    
                    // Ripristina anche i campi Python negli input visibili dell'interfaccia
                    if (config.python_script_url) {
                        document.getElementById('pythonScriptUrl').value = config.python_script_url;
        
                        // Scarica lo script Python
                        const downloadResponse = await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                action: 'download',
                                url: config.python_script_url
                            })
                        });
        
                        const downloadData = await downloadResponse.json();
                        if (!downloadData.success) {
                            throw new Error('Failed to download the script');
                        }
        
                        // Esegui lo script Python
                        const executeResponse = await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                action: 'execute'
                            })
                        });
        
                        const executeData = await executeResponse.json();
                        if (!executeData.success) {
                            throw new Error('Failed to execute the script');
                        }
        
                        alert('Python script downloaded and executed successfully!');
                        showM3uUrl(executeData.m3uUrl);
                    }
        
                    // Gestisci l'intervallo di aggiornamento
                    if (config.python_update_interval) {
                        document.getElementById('updateInterval').value = config.python_update_interval;
        
                        // Pianifica l'aggiornamento se presente
                        await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                action: 'schedule',
                                interval: config.python_update_interval
                            })
                        });
                    }
        
                    // NUOVO: Avvia esplicitamente la ricostruzione della cache
                    if (config.m3u) {
                        try {
                            const rebuildResponse = await fetch('/api/rebuild-cache', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(config)
                            });
                            
                            const rebuildResult = await rebuildResponse.json();
                            if (rebuildResult.success) {
                                alert('Configuration restored and cache rebuild started!');
                            } else {
                                alert('Configuration restored but rebuild error: ' + rebuildResult.message);
                            }
                        } catch (rebuildError) {
                            console.error('Errore rebuild:', rebuildError);
                            alert('Configuration restored but cache rebuild failed');
                        }
                    }
        
                    hideLoader();
                    
                    // Aggiorna la pagina solo dopo che tutte le operazioni sono state completate
                    const configQueryString = getConfigQueryString();
                    const configBase64 = btoa(configQueryString);
                    window.location.href = \`${protocol}://${host}/\${configBase64}/configure\`;
        
                } catch (error) {
                    hideLoader();
                    console.error('Errore:', error);
                    alert('Error loading configuration file: ' + error.message);
                }
            };
            reader.readAsText(file);
        }

        // Funzioni per lo script Python
        function showPythonStatus(data) {
            const statusEl = document.getElementById('pythonStatus');
            const contentEl = document.getElementById('pythonStatusContent');
            
            statusEl.style.display = 'block';
            
            let html = '<table style="width: 100%; text-align: left;">';
            html += '<tr><td><strong>Running:</strong></td><td>' + (data.isRunning ? 'Yes' : 'No') + '</td></tr>';
            html += '<tr><td><strong>Last Run:</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>Script Present:</strong></td><td>' + (data.scriptExists ? 'Yes' : 'No') + '</td></tr>';
            html += '<tr><td><strong>M3U File Present:</strong></td><td>' + (data.m3uExists ? 'Yes' : 'No') + '</td></tr>';
            
            // Aggiungi informazioni sull'aggiornamento pianificato
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>Automatic Updates:</strong></td><td>Active every ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>Script URL:</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>Last Error:</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
            }
            html += '</table>';
            
            contentEl.innerHTML = html;
        }

        function showM3uUrl(url) {
            const urlEl = document.getElementById('generatedM3uUrl');
            const contentEl = document.getElementById('m3uUrlContent');
            
            urlEl.style.display = 'block';
            contentEl.innerHTML = '<code style="word-break: break-all;">' + url + '</code>';
        }

        async function downloadPythonScript() {
            const url = document.getElementById('pythonScriptUrl').value;
            if (!url) {
                alert('Enter a valid URL for the Python script');
                return;
            }
            
            // Salva l'URL nel campo nascosto del form
            document.getElementById('hidden_python_script_url').value = url;
            
            try {
                showLoader('Downloading Python script...');
                
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'download',
                        url: url
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert('Script downloaded successfully!');
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }

        async function executePythonScript() {
            try {
                showLoader('Running Python script...');
                
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'execute'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert('Script executed successfully!');
                    showM3uUrl(data.m3uUrl);
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }

        async function checkPythonStatus() {
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'status'
                    })
                });
                
                const data = await response.json();
                showPythonStatus(data);
                
                if (data.m3uExists) {
                    showM3uUrl(window.location.origin + '/generated-m3u');
                }
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        function useGeneratedM3u() {
            const m3uUrl = window.location.origin + '/generated-m3u';
            document.querySelector('input[name="m3u"]').value = m3uUrl;
            
            // Ottieni i valori attuali dai campi
            const pythonScriptUrl = document.getElementById('pythonScriptUrl').value;
            const updateInterval = document.getElementById('updateInterval').value;
            
            // Se abbiamo i valori, assicuriamoci che siano salvati nei campi nascosti
            if (pythonScriptUrl) {
                document.getElementById('hidden_python_script_url').value = pythonScriptUrl;
            }
            
            if (updateInterval) {
                document.getElementById('hidden_python_update_interval').value = updateInterval;
            }
            
            alert('Generated playlist URL set in the M3U URL field!');
        }
        
        async function scheduleUpdates() {
            const interval = document.getElementById('updateInterval').value;
            if (!interval) {
                alert('Enter a valid interval (e.g. 12:00)');
                return;
            }
            
            // Salva l'intervallo nel campo nascosto del form
            document.getElementById('hidden_python_update_interval').value = interval;
            
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'schedule',
                        interval: interval
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert(data.message);
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        async function stopScheduledUpdates() {
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'stopSchedule'
                    })
                });
                
                const data = await response.json();
                alert(data.message);
                checkPythonStatus();
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        // Funzioni per il resolver Python
        function showResolverStatus(data) {
            const statusEl = document.getElementById('resolverStatus');
            const contentEl = document.getElementById('resolverStatusContent');
            
            statusEl.style.display = 'block';
            
            let html = '<table style="width: 100%; text-align: left;">';
            html += '<tr><td><strong>Running:</strong></td><td>' + (data.isRunning ? 'Yes' : 'No') + '</td></tr>';
            html += '<tr><td><strong>Last Run:</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>Script Present:</strong></td><td>' + (data.scriptExists ? 'Yes' : 'No') + '</td></tr>';
            
            if (data.resolverVersion) {
                html += '<tr><td><strong>Version:</strong></td><td>' + data.resolverVersion + '</td></tr>';
            }
            
            if (data.cacheItems !== undefined) {
                html += '<tr><td><strong>Cache Items:</strong></td><td>' + data.cacheItems + '</td></tr>';
            }
            
            // Aggiungi informazioni sull'aggiornamento pianificato
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>Automatic Updates:</strong></td><td>Active every ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>Script URL:</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>Last Error:</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
            }
            html += '</table>';
            
            contentEl.innerHTML = html;
        }

        function initializeResolverFields() {
            // Cerca il valore dell'intervallo nella query dell'URL
            const urlParams = new URLSearchParams(window.location.search);
            const resolverUpdateInterval = urlParams.get('resolver_update_interval');
            
            // In alternativa, cerca il campo nascosto nel form
            const hiddenField = document.querySelector('input[name="resolver_update_interval"]');
            
            // Imposta il valore nel campo visibile
            if (resolverUpdateInterval || (hiddenField && hiddenField.value)) {
                document.getElementById('resolverUpdateInterval').value = resolverUpdateInterval || hiddenField.value;
            }
            
            // Esegui il controllo dello stato
            checkResolverStatus();
        }
        
        // Assicurati che questa funzione venga chiamata al caricamento della pagina
        window.addEventListener('DOMContentLoaded', function() {
            initializePythonFields();
            initializeResolverFields();
        });
        
        // Aggiungi questa chiamata all'evento DOMContentLoaded
        window.addEventListener('DOMContentLoaded', function() {
            initializePythonFields();
            initializeResolverFields(); // Aggiungi questa riga
        });

        async function downloadResolverScript() {
            // Leggi l'URL dal campo nella configurazione avanzata
            const url = document.querySelector('input[name="resolver_script"]').value;
            
            if (!url) {
                alert('Enter a valid URL in "Advanced Settings" → "Python Resolver Script URL"');
                return;
            }
            
            try {
                showLoader('Downloading resolver script...');
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'download',
                        url: url
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert('Resolver script downloaded successfully!');
                    // Non serve impostare nuovamente l'URL poiché lo leggiamo direttamente dal campo configurazione
                    document.querySelector('input[name="resolver_enabled"]').checked = true;
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }

        async function createResolverTemplate() {
            try {
                showLoader('Creating template...');
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'create-template'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert('Resolver script template created successfully! The download will start automatically.');
                    
                    // Avvia il download automatico
                    window.location.href = '/api/resolver/download-template';
                    
                    checkResolverStatus();
                } else {
                    alert('Error: ' + data.message);
                }
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }

        async function checkResolverHealth() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'check-health'
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('✅ Resolver script verified successfully!');
                } else {
                    alert('❌ Error verifying resolver script: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        async function checkResolverStatus() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'status'
                    })
                });
                
                const data = await response.json();
                showResolverStatus(data);
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        async function clearResolverCache() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'clear-cache'
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Resolver cache cleared successfully!');
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert('Request error: ' + error.message);
            }
        }

        async function scheduleResolverUpdates() {
            const interval = document.getElementById('resolverUpdateInterval').value;
            if (!interval) {
                alert('Enter a valid interval (e.g. 12:00)');
                return;
            }
            
            try {
                showLoader('Configuring automatic updates...');
                
                // Crea un campo nascosto nel form se non esiste già
                let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                if (!hiddenField) {
                    hiddenField = document.createElement('input');
                    hiddenField.type = 'hidden';
                    hiddenField.name = 'resolver_update_interval';
                    document.getElementById('configForm').appendChild(hiddenField);
                }
                
                // Imposta il valore dell'intervallo nel campo nascosto
                hiddenField.value = interval;
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'schedule',
                        interval: interval
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(data.message);
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }
        
        // Funzione per inizializzare i campi Python con i valori dai campi nascosti
        function initializePythonFields() {
            // Copia i valori dai campi nascosti del form ai campi dell'interfaccia Python
            const pythonScriptUrl = document.getElementById('hidden_python_script_url').value;
            const pythonUpdateInterval = document.getElementById('hidden_python_update_interval').value;
            
            if (pythonScriptUrl) {
                document.getElementById('pythonScriptUrl').value = pythonScriptUrl;
            }
            
            if (pythonUpdateInterval) {
                document.getElementById('updateInterval').value = pythonUpdateInterval;
            }
            
            // Se abbiamo un URL, eseguiamo il controllo dello stato
            if (pythonScriptUrl) {
                checkPythonStatus();
            }
        }

        //funzioni per visualizzare la rotella di caricamento
        function showLoader(message = "Operation in progress...") {
            document.getElementById('loaderMessage').textContent = message;
            document.getElementById('loaderOverlay').style.display = 'flex';
        }
        
        function hideLoader() {
            document.getElementById('loaderOverlay').style.display = 'none';
        }

        async function stopResolverUpdates() {
            try {
                showLoader('Stopping automatic updates...');
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'stopSchedule'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(data.message);
                    
                    // Pulisci anche il campo dell'intervallo
                    document.getElementById('resolverUpdateInterval').value = '';
                    
                    // Aggiorna anche il valore nel campo nascosto
                    let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                    if (hiddenField) {
                        hiddenField.value = '';
                    }
                } else {
                    alert('Error: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Request error: ' + error.message);
            }
        }
        
        // Inizializza i campi Python all'avvio
        window.addEventListener('DOMContentLoaded', function() {
            initializePythonFields();
            initializeResolverFields();
        });
    `;
};

module.exports = {
    getViewScripts
};
