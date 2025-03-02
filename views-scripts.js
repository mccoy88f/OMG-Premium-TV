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

        // Funzione per gestire lo switch tra URL e file locale
        function toggleM3USource(useLocalFile) {
            const urlInput = document.getElementById('m3u_url_input');
            const fileSection = document.getElementById('m3u_file_section');
            
            if (useLocalFile) {
                urlInput.disabled = true;
                urlInput.required = false;
                fileSection.style.display = 'block';
            } else {
                urlInput.disabled = false;
                urlInput.required = true;
                fileSection.style.display = 'none';

                // Non resettare il contenuto del file quando si disattiva l'opzione,
                // in modo che se l'utente riattiva l'opzione, il contenuto sia ancora disponibile
                // document.getElementById('m3u_file_input').value = '';
                // document.getElementById('file_content_preview').style.display = 'none';
                // document.getElementById('m3u_file_content').value = '';
            }
        }

        // Funzione per gestire il caricamento del file
        document.addEventListener('DOMContentLoaded', function() {
            // Event listener per il checkbox
            const useLocalFileCheckbox = document.getElementById('use_local_file');
            if (useLocalFileCheckbox) {
                useLocalFileCheckbox.addEventListener('change', function() {
                    toggleM3USource(this.checked);
                });
            }
            
            // Event listener per il file input
            const fileInput = document.getElementById('m3u_file_input');
            if (fileInput) {
                fileInput.addEventListener('change', handleFileUpload);
            }
            
            // Chiamata iniziale per impostare lo stato corretto
            if (useLocalFileCheckbox) {
                toggleM3USource(useLocalFileCheckbox.checked);
            }
        });

        async function handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            showLoader('Caricamento playlist in corso...');
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                const content = e.target.result;
                
                try {
                    // Mostra anteprima del contenuto
                    document.getElementById('file_content').textContent = content;
                    document.getElementById('file_content_preview').style.display = 'block';
                    
                    // Salva il contenuto in un campo nascosto per il form
                    document.getElementById('m3u_file_content').value = content;
                    
                    // Richiedi la cancellazione del vecchio file e il caricamento del nuovo
                    const response = await fetch('/upload-playlist', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ 
                            content: content,
                            timestamp: Date.now() // Aggiungiamo un timestamp per evitare caching
                        })
                    });
        
                    const result = await response.json();
        
                    if (result.success) {
                        // Attendiamo un po' per essere sicuri che il file sia stato salvato e processato
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Forza ricostruzione della cache con nuovi parametri
                        const timestamp = Date.now();
                        const filePathWithTimestamp = 'file://' + result.path + '?t=' + timestamp;
        
                        const rebuildResponse = await fetch('/api/rebuild-cache', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                m3u: 'file://' + result.path,  // Rimuoviamo il timestamp dall'URL
                                use_local_file: true,
                                force_rebuild: true,           // Usiamo questa opzione per forzare la ricostruzione
                                timestamp: Date.now()          // Aggiungiamo il timestamp come parametro separato
                            })
                        });
                        
                        hideLoader();
                        
                        if (rebuildResult.success) {
                            alert('Playlist caricata e catalogo ricostruito con successo!');
                        } else {
                            alert('Errore nella ricostruzione del catalogo: ' + rebuildResult.message);
                        }
                    } else {
                        hideLoader();
                        alert('Errore nel caricamento del file: ' + result.message);
                    }
                } catch (error) {
                    hideLoader();
                    console.error('Errore:', error);
                    alert('Errore durante il caricamento del file: ' + error.message);
                }
            };
            
            reader.readAsText(file);
        }
        // Funzioni per la gestione della configurazione
        function getConfigQueryString() {
            const form = document.getElementById('configForm');
            const formData = new FormData(form);
            const params = new URLSearchParams();
            
            // Gestisci lo stato dei checkbox
            const useLocalFile = document.getElementById('use_local_file').checked;
            params.append('use_local_file', useLocalFile);
            
            const includePythonPlaylist = document.getElementById('include_python_playlist').checked;
            params.append('include_python_playlist', includePythonPlaylist);
            
            formData.forEach((value, key) => {
                if (value || key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled' || 
                   key === 'use_local_file' || key === 'include_python_playlist') {
                    if (key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled') {
                        params.append(key, form.elements[key].checked);
                    } else if (key === 'use_local_file' || key === 'include_python_playlist') {
                        // Già gestiti sopra
                    } else if (key === 'm3u' && useLocalFile) {
                        // Non aggiungere l'URL M3U se use_local_file è true
                        // Verrà gestito lato server
                    } else if (key === 'm3u_file_content') {
                        // Non includere il contenuto del file nell'URL
                        // Verrà gestito separatamente
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
            params.use_local_file = params.use_local_file === 'true';
            params.include_python_playlist = params.include_python_playlist === 'true';
            
            // Se stiamo usando un file locale, salva anche il contenuto nel backup
            if (params.use_local_file) {
                params.m3u_file_content = document.getElementById('m3u_file_content').value;
            }
            
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
        
            showLoader('Ripristino configurazione in corso...');
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const config = JSON.parse(e.target.result);
        
                    const form = document.getElementById('configForm');
                    
                    // Gestisci l'opzione use_local_file
                    if (config.use_local_file) {
                        document.getElementById('use_local_file').checked = true;
                        toggleM3USource(true);
                        
                        // Se abbiamo anche il contenuto del file, ripristinalo
                        if (config.m3u_file_content) {
                            document.getElementById('m3u_file_content').value = config.m3u_file_content;
                            document.getElementById('file_content').textContent = config.m3u_file_content;
                            document.getElementById('file_content_preview').style.display = 'block';
        
                            // Salva il contenuto nel file
                            try {
                                const response = await fetch('/save-local-file', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ 
                                        content: config.m3u_file_content 
                                    })
                                });
        
                                if (!response.ok) {
                                    throw new Error('Errore nel salvataggio del file');
                                }
                            } catch (saveError) {
                                console.error('Errore nel salvataggio del file:', saveError);
                                alert('Errore nel ripristino del file M3U');
                            }
                        }
                    } else {
                        document.getElementById('use_local_file').checked = false;
                        toggleM3USource(false);
                    }
        
                    // Gestisci l'opzione include_python_playlist
                    if (config.include_python_playlist !== undefined) {
                        document.getElementById('include_python_playlist').checked = config.include_python_playlist;
                    }
                    
                    // Continua con il resto del ripristino delle altre impostazioni
                    for (const [key, value] of Object.entries(config)) {
                        // Ignora le proprietà speciali gestite separatamente
                        if (key === 'use_local_file' || key === 'm3u_file_content' || key === 'include_python_playlist') continue;
                        
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
                    
                    // Ripristina anche i campi Python
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
                            throw new Error('Download dello script fallito');
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
                            throw new Error('Esecuzione dello script fallita');
                        }
        
                        alert('Script Python scaricato ed eseguito con successo!');
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
        
                    // Avvia esplicitamente la ricostruzione della cache
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
                                alert('Configurazione ripristinata e ricostruzione cache avviata!');
                            } else {
                                alert('Configurazione ripristinata ma errore nella ricostruzione: ' + rebuildResult.message);
                            }
                        } catch (rebuildError) {
                            console.error('Errore rebuild:', rebuildError);
                            alert('Configurazione ripristinata ma errore nella ricostruzione della cache');
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
                    alert('Errore nel caricamento del file di configurazione: ' + error.message);
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
            html += '<tr><td><strong>In Esecuzione:</strong></td><td>' + (data.isRunning ? 'Sì' : 'No') + '</td></tr>';
            html += '<tr><td><strong>Ultima Esecuzione:</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>Script Esistente:</strong></td><td>' + (data.scriptExists ? 'Sì' : 'No') + '</td></tr>';
            html += '<tr><td><strong>File M3U Esistente:</strong></td><td>' + (data.m3uExists ? 'Sì' : 'No') + '</td></tr>';
            
            // Aggiungi informazioni sull'aggiornamento pianificato
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>Aggiornamento Automatico:</strong></td><td>Attivo ogni ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>URL Script:</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>Ultimo Errore:</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
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
                alert('Inserisci un URL valido per lo script Python');
                return;
            }
            
            // Salva l'URL nel campo nascosto del form
            document.getElementById('hidden_python_script_url').value = url;
            
            try {
                showLoader('Download script Python in corso...');
                
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
                    alert('Script scaricato con successo!');
                } else {
                    alert('Errore: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
            }
        }

        async function executePythonScript() {
            try {
                showLoader('Esecuzione script Python in corso...');
                
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
                    alert('Script eseguito con successo!');
                    showM3uUrl(data.m3uUrl);
                } else {
                    alert('Errore: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
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
                alert('Errore nella richiesta: ' + error.message);
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
            
            alert('URL della playlist generata impostato nel campo M3U URL!');
        }
        
        async function scheduleUpdates() {
            const interval = document.getElementById('updateInterval').value;
            if (!interval) {
                alert('Inserisci un intervallo valido (es. 12:00)');
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
                    alert('Errore: ' + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                alert('Errore nella richiesta: ' + error.message);
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
                alert('Errore nella richiesta: ' + error.message);
            }
        }

        // Funzioni per il resolver Python
        function showResolverStatus(data) {
            const statusEl = document.getElementById('resolverStatus');
            const contentEl = document.getElementById('resolverStatusContent');
            
            statusEl.style.display = 'block';
            
            let html = '<table style="width: 100%; text-align: left;">';
            html += '<tr><td><strong>In Esecuzione:</strong></td><td>' + (data.isRunning ? 'Sì' : 'No') + '</td></tr>';
            html += '<tr><td><strong>Ultima Esecuzione:</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>Script Esistente:</strong></td><td>' + (data.scriptExists ? 'Sì' : 'No') + '</td></tr>';
            
            if (data.resolverVersion) {
                html += '<tr><td><strong>Versione:</strong></td><td>' + data.resolverVersion + '</td></tr>';
            }
            
            if (data.cacheItems !== undefined) {
                html += '<tr><td><strong>Item in Cache:</strong></td><td>' + data.cacheItems + '</td></tr>';
            }
            
            // Aggiungi informazioni sull'aggiornamento pianificato
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>Aggiornamento Automatico:</strong></td><td>Attivo ogni ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>URL Script:</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>Ultimo Errore:</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
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

        async function downloadResolverScript() {
            // Leggi l'URL dal campo nella configurazione avanzata
            const url = document.querySelector('input[name="resolver_script"]').value;
            
            if (!url) {
                alert('Inserisci un URL valido nella sezione "Impostazioni Avanzate" → "URL Script Resolver Python"');
                return;
            }
            
            try {
                showLoader('Download script resolver in corso...');
                
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
                    alert('Script resolver scaricato con successo!');
                    // Non serve impostare nuovamente l'URL poiché lo leggiamo direttamente dal campo configurazione
                    document.querySelector('input[name="resolver_enabled"]').checked = true;
                } else {
                    alert('Errore: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
            }
        }

        async function createResolverTemplate() {
            try {
                showLoader('Creazione template in corso...');
                
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
                    alert('Template dello script resolver creato con successo! Il download inizierà automaticamente.');
                    
                    // Avvia il download automatico
                    window.location.href = '/api/resolver/download-template';
                    
                    checkResolverStatus();
                } else {
                    alert('Errore: ' + data.message);
                }
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
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
                    alert('✅ Script resolver verificato con successo!');
                } else {
                    alert('❌ Errore nella verifica dello script: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert('Errore nella richiesta: ' + error.message);
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
                alert('Errore nella richiesta: ' + error.message);
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
                    alert('Cache del resolver svuotata con successo!');
                } else {
                    alert('Errore: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert('Errore nella richiesta: ' + error.message);
            }
        }

        async function scheduleResolverUpdates() {
            const interval = document.getElementById('resolverUpdateInterval').value;
            if (!interval) {
                alert('Inserisci un intervallo valido (es. 12:00)');
                return;
            }
            
            try {
                showLoader('Configurazione aggiornamento automatico in corso...');
                
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
                    alert('Errore: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
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

        function readLocalM3UFile() {
            const fs = require('fs');
            const path = require('path');
            const uploadsDir = path.join(__dirname, 'uploads');
            const filePath = path.join(uploadsDir, 'user_playlist.txt');
            
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    return content;
                }
            } catch (error) {
                console.error('Errore nella lettura del file M3U locale:', error);
            }
            return '';
        }

        //funzioni per visualizzare la rotella di caricamento
        function showLoader(message = "Operazione in corso...") {
            document.getElementById('loaderMessage').textContent = message;
            document.getElementById('loaderOverlay').style.display = 'flex';
        }
        
        function hideLoader() {
            document.getElementById('loaderOverlay').style.display = 'none';
        }

        async function stopResolverUpdates() {
            try {
                showLoader('Arresto aggiornamenti automatici in corso...');
                
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
                    alert('Errore: ' + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert('Errore nella richiesta: ' + error.message);
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
