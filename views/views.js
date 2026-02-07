const fs = require('fs');
const path = require('path');
const { getViewScripts } = require('./views-scripts');

function renderGatePage(manifest, returnPath) {
    const returnUrl = (returnPath && returnPath.startsWith('/')) ? returnPath : '';
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${manifest.name} - Access</title>
    <style>
        body { margin: 0; padding: 0; height: 100vh; font-family: Arial, sans-serif; color: #fff; background: #2d1b4e; display: flex; justify-content: center; align-items: center; }
        .gate-box { background: rgba(0,0,0,0.5); padding: 40px; border-radius: 8px; max-width: 360px; width: 90%; text-align: center; }
        .gate-box h1 { font-size: 20px; margin-bottom: 20px; }
        .gate-box input[type="password"] { width: 100%; padding: 12px; margin-bottom: 15px; border-radius: 4px; border: 1px solid #666; background: #333; color: white; box-sizing: border-box; }
        .gate-box button { background: #8A5AAB; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; width: 100%; }
        .gate-box .error { color: #f44336; margin-top: 10px; font-size: 14px; display: none; }
    </style>
</head>
<body>
    <div class="gate-box">
        <h1>Configuration access</h1>
        <p style="color: #aaa; margin-bottom: 20px;">Enter the password to access the addon home.</p>
        <form id="gateForm" method="post" action="/api/home-auth/unlock">
            <input type="hidden" name="returnUrl" value="${returnUrl}">
            <input type="password" name="password" id="gatePassword" placeholder="Password" required autofocus>
            <button type="submit">Log in</button>
        </form>
        <p id="gateError" class="error"></p>
    </div>
    <script>
        document.getElementById('gateForm').addEventListener('submit', function(e) {
            var p = document.getElementById('gatePassword').value;
            if (!p || p.trim() === '') { e.preventDefault(); document.getElementById('gateError').textContent = 'Enter the password'; document.getElementById('gateError').style.display = 'block'; return false; }
        });
        var err = new URLSearchParams(window.location.search).get('error');
        if (err) { document.getElementById('gateError').textContent = 'Incorrect password'; document.getElementById('gateError').style.display = 'block'; }
    </script>
</body>
</html>`;
}

const renderConfigPage = (protocol, host, query, manifest, sessionKey = null, showSessionChangeWarning = false) => {
   // Verifica se il file addon-config.json esiste
   const configPath = path.join(__dirname, '..', 'addon-config.json');
   const m3uDefaultUrl = 'https://github.com/mccoy88f/OMG-Premium-TV/blob/main/tv.png?raw=true';
   const m3uIsDisabled = !fs.existsSync(configPath);
   const sessionIdDisplay = sessionKey || '—';

   return `
       <!DOCTYPE html>
       <html>
       <head>
           <meta charset="utf-8">
           <title>${manifest.name}</title>
           <style>
               body {
                   margin: 0;
                   padding: 0;
                   height: 100vh;
                   overflow-y: auto;
                   font-family: Arial, sans-serif;
                   color: #fff;
                   background: purple;
               }
               #background-video {
                   position: fixed;
                   right: 0;
                   bottom: 0;
                   min-width: 100%;
                   min-height: 100%;
                   width: auto;
                   height: auto;
                   z-index: -1000;
                   background: black;
                   object-fit: cover;
                   filter: blur(5px) brightness(0.5);
               }
               .content {
                   position: relative;
                   z-index: 1;
                   max-width: 800px;
                   margin: 0 auto;
                   text-align: center;
                   padding: 50px 20px;
                   background: rgba(0,0,0,0.6);
                   min-height: 100vh;
                   display: flex;
                   flex-direction: column;
                   justify-content: flex-start;
                   overflow-y: visible;
               }

               .logo {
                   width: 150px;
                   margin: 0 auto 20px;
                   display: block;
               }
               .manifest-url {
                   background: rgba(255,255,255,0.1);
                   padding: 10px;
                   border-radius: 4px;
                   word-break: break-all;
                   margin: 20px 0;
                   font-size: 12px;
               }

               .loader-overlay {
                   position: fixed;
                   top: 0;
                   left: 0;
                   width: 100%;
                   height: 100%;
                   background: rgba(0,0,0,0.8);
                   display: none;
                   justify-content: center;
                   align-items: center;
                   z-index: 2000;
                   flex-direction: column;
               }
               
               .loader {
                   border: 6px solid #3d2a56;
                   border-radius: 50%;
                   border-top: 6px solid #8A5AAB;
                   width: 50px;
                   height: 50px;
                   animation: spin 1s linear infinite;
                   margin-bottom: 20px;
               }
               
               .loader-message {
                   color: white;
                   font-size: 18px;
                   text-align: center;
                   max-width: 80%;
               }
               
               @keyframes spin {
                   0% { transform: rotate(0deg); }
                   100% { transform: rotate(360deg); }
               }
               
               .config-form {
                   text-align: left;
                   background: rgba(255,255,255,0.1);
                   padding: 20px;
                   border-radius: 4px;
                   margin-top: 30px;
               }
               .config-form label {
                   display: block;
                   margin: 10px 0 5px;
                   color: #fff;
               }
               .config-form input[type="text"],
               .config-form input[type="url"],
               .config-form input[type="password"],
               .config-form input[type="file"] {
                   width: 100%;
                   padding: 8px;
                   margin-bottom: 10px;
                   border-radius: 4px;
                   border: 1px solid #666;
                   background: #333;
                   color: white;
               }
               .buttons {
                   margin: 30px 0;
                   display: flex;
                   justify-content: center;
                   gap: 20px;
               }
               button {
                   background: #8A5AAB;
                   color: white;
                   border: none;
                   padding: 12px 24px;
                   border-radius: 4px;
                   cursor: pointer;
                   font-size: 16px;
               }
               .bottom-buttons {
                   margin-top: 20px;
                   display: flex;
                   justify-content: center;
                   gap: 20px;
               }
               .toast {
                   position: fixed;
                   top: 20px;
                   right: 20px;
                   background: #4CAF50;
                   color: white;
                   padding: 15px 30px;
                   border-radius: 4px;
                   display: none;
               }
               input[type="submit"] {
                   background: #8A5AAB;
                   color: white;
                   border: none;
                   padding: 12px 24px;
                   border-radius: 4px;
                   cursor: pointer;
                   font-size: 16px;
                   width: 100%;
                   margin-top: 20px;
               }
               .advanced-settings {
                   background: rgba(255,255,255,0.05);
                   border: 1px solid #666;
                   border-radius: 4px;
                   padding: 10px;
                   margin-top: 10px;
               }
               .advanced-settings-header {
                   cursor: pointer;
                   display: flex;
                   justify-content: space-between;
                   align-items: center;
                   color: #fff;
               }
               .advanced-settings-content {
                   display: none;
                   padding-top: 10px;
               }
               .advanced-settings-content.show {
                   display: block;
               }
               #confirmModal {
                   display: none;
                   position: fixed;
                   top: 0;
                   left: 0;
                   width: 100%;
                   height: 100%;
                   background: rgba(0,0,0,0.8);
                   z-index: 1000;
                   justify-content: center;
                   align-items: center;
               }
               #confirmModal > div {
                   background: #333;
                   padding: 30px;
                   border-radius: 10px;
                   text-align: center;
                   color: white;
               }
               #confirmModal button {
                   margin: 0 10px;
               }
               a {
                   color: #8A5AAB;
                   text-decoration: none;
               }
               a:hover {
                   text-decoration: underline;
               }
           </style>
       </head>
       <body>
           <video autoplay loop muted id="background-video">
               <source src="https://static.vecteezy.com/system/resources/previews/001/803/236/mp4/no-signal-bad-tv-free-video.mp4" type="video/mp4">
               Il tuo browser non supporta il tag video.
           </video>

           <div class="content">
               <div id="langBar" style="position: absolute; top: 15px; right: 20px; font-size: 14px; color: #ccc;">
                   <a href="#" id="langEn" onclick="setLanguage('en'); return false;" style="color: inherit; text-decoration: none; margin-right: 6px;">🇬🇧 ENG</a>
                   <span style="color: #666;">|</span>
                   <a href="#" id="langIt" onclick="setLanguage('it'); return false;" style="color: inherit; text-decoration: none; margin: 0 6px;">🇮🇹 ITA</a>
                   <span style="color: #666;">|</span>
                   <a href="#" id="langEs" onclick="setLanguage('es'); return false;" style="color: inherit; text-decoration: none; margin: 0 6px;">🇪🇸 ESP</a>
                   <span style="color: #666;">|</span>
                   <a href="#" id="langFr" onclick="setLanguage('fr'); return false;" style="color: inherit; text-decoration: none; margin-left: 6px;">🇫🇷 FRA</a>
               </div>
               <img class="logo" src="${manifest.logo}" alt="logo">
               <h1>${manifest.name} <span style="font-size: 16px; color: #aaa;">v${manifest.version}</span></h1>

               
               <div class="manifest-url">
                   <strong>URL Manifest:</strong><br>
                   ${protocol}://${host}/manifest.json?${new URLSearchParams(query)}
               </div>

               <div class="buttons">
                   <button onclick="copyManifestUrl()" data-i18n="copy_manifest">COPY MANIFEST URL</button>
                   <button onclick="installAddon()" data-i18n="install_stremio">INSTALL ON STREMIO</button>
               </div>
               
               <div class="config-form">
                   <h2 data-i18n="playlist_epg">Playlist & EPG</h2>
                   ${showSessionChangeWarning ? `
                   <div class="session-change-warning" style="margin-bottom: 1rem; padding: 12px 16px; background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 8px; color: #ffc107; font-size: 14px;">
                       <strong>⚠️ <span data-i18n="session_warning_title">Configuration updated</span></strong><br>
                       <span data-i18n="session_warning_text">Session has changed. To use this configuration in Stremio: remove the addon and reinstall (or click "Install on Stremio" below).</span>
                   </div>
                   ` : ''}
                   <div class="preset-iptv-box" style="margin-bottom: 1.25rem; padding: 1rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                       <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem;" data-i18n="preset_title">Preset lists (optional)</h3>
                       <p style="color: #aaa; font-size: 13px; margin: 0 0 0.75rem 0;" data-i18n="preset_desc">Adds predefined iptv-org playlist and iptv-epg.org EPG URLs to your configuration. Select a country to append these URLs to the M3U and EPG fields below.</p>
                       <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;">
                           <select id="presetCountry" style="padding: 8px 12px; border-radius: 4px; border: 1px solid #666; background: #333; color: white; min-width: 200px;">
                               <option value="" data-i18n="preset_select">— Select country —</option>
                           </select>
                           <button type="button" onclick="applyPresetCountry()" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;" data-i18n="preset_apply">Add to configuration</button>
                       </div>
                   </div>
                   <form id="configForm" onsubmit="updateConfig(event)">
                       <label data-i18n="m3u_url">M3U URL:</label>
                       <input type="text" name="m3u" 
                              value="${m3uIsDisabled ? m3uDefaultUrl : (query.m3u || '')}" 
                              ${m3uIsDisabled ? 'readonly' : ''} 
                              data-i18n-placeholder="m3u_placeholder"
                              placeholder="https://example.com/playlist1.m3u,https://example.com/playlist2.m3u"
                              required>
                       <small style="color: #999; display: block; margin-top: 5px;" data-i18n="m3u_hint">
                           💡 You can enter multiple M3U URLs separated by a comma (,)
                       </small>
                       
                       <label data-i18n="epg_url">EPG URL:</label>
                       <input type="text" name="epg" 
                              value="${query.epg || ''}"
                              data-i18n-placeholder="epg_placeholder"
                              placeholder="https://example.com/epg1.xml,https://example.com/epg2.xml">
                       <small style="color: #999; display: block; margin-top: 5px;" data-i18n="epg_hint">
                           💡 You can enter multiple EPG URLs separated by a comma (,)
                       </small>
                       
                       <label>
                           <input type="checkbox" name="epg_enabled" ${query.epg_enabled === 'true' ? 'checked' : ''}>
                           <span data-i18n="enable_epg">Enable EPG</span>
                       </label>

                       <label data-i18n="channel_language">Channel language:</label>
                       <select name="language" style="width: 100%; padding: 8px; margin-bottom: 6px; border-radius: 4px; border: 1px solid #666; background: #333; color: white;">
                           <option value="Italiano" ${(query.language || 'Italiano') === 'Italiano' ? 'selected' : ''}>Italiano</option>
                           <option value="English" ${query.language === 'English' ? 'selected' : ''}>English</option>
                           <option value="Español" ${query.language === 'Español' ? 'selected' : ''}>Español</option>
                           <option value="Français" ${query.language === 'Français' ? 'selected' : ''}>Français</option>
                           <option value="Deutsch" ${query.language === 'Deutsch' ? 'selected' : ''}>Deutsch</option>
                           <option value="Português" ${query.language === 'Português' ? 'selected' : ''}>Português</option>
                           <option value="Nederlands" ${query.language === 'Nederlands' ? 'selected' : ''}>Nederlands</option>
                           <option value="Polski" ${query.language === 'Polski' ? 'selected' : ''}>Polski</option>
                           <option value="Русский" ${query.language === 'Русский' ? 'selected' : ''}>Русский</option>
                           <option value="العربية" ${query.language === 'العربية' ? 'selected' : ''}>العربية</option>
                           <option value="中文" ${query.language === '中文' ? 'selected' : ''}>中文</option>
                           <option value="日本語" ${query.language === '日本語' ? 'selected' : ''}>日本語</option>
                           <option value="한국어" ${query.language === '한국어' ? 'selected' : ''}>한국어</option>
                       </select>
                       <small style="color: #999; display: block; margin-bottom: 10px;" data-i18n="channel_language_hint">Only used for compatibility with AIOStreams.</small>

                       <div class="advanced-settings">
                           <div class="advanced-settings-header" onclick="toggleAdvancedSettings()">
                               <strong data-i18n="advanced_settings">Advanced settings</strong>
                               <span id="advanced-settings-toggle">▼</span>
                           </div>
                           <div class="advanced-settings-content" id="advanced-settings-content">
                               <label data-i18n="proxy_url">Proxy URL:</label>
                               <input type="url" name="proxy" value="${query.proxy || ''}">
                               
                               <label data-i18n="proxy_pwd">Proxy password:</label>
                               <input type="password" name="proxy_pwd" value="${query.proxy_pwd || ''}">
                               
                               <label>
                                   <input type="checkbox" name="force_proxy" ${query.force_proxy === 'true' ? 'checked' : ''}>
                                   <span data-i18n="force_proxy">Force proxy</span>
                               </label>

                               <label data-i18n="id_suffix">ID suffix:</label>
                               <input type="text" name="id_suffix" value="${query.id_suffix || ''}" data-i18n-placeholder="id_suffix_placeholder" placeholder="Example: it">

                               <label data-i18n="remapper_path">Remapper file path:</label>
                               <input type="text" name="remapper_path" value="${query.remapper_path || ''}" data-i18n-placeholder="remapper_placeholder" placeholder="Example: https://raw.githubusercontent.com/...">

                               <label data-i18n="update_interval">Playlist update interval:</label>
                               <input type="text" name="update_interval" value="${query.update_interval || '12:00'}" data-i18n-placeholder="update_interval_placeholder" placeholder="HH:MM (default 12:00)">
                               <small style="color: #999;" data-i18n="update_interval_hint">Format HH:MM (e.g. 1:00 or 01:00), default 12:00</small>
                               
                           </div>
                       </div>
                       <input type="hidden" name="python_script_url" id="hidden_python_script_url" value="${query.python_script_url || ''}">
                       <input type="hidden" name="python_update_interval" id="hidden_python_update_interval" value="${query.python_update_interval || ''}">
                       <input type="hidden" name="resolver_script" id="hidden_resolver_script" value="${query.resolver_script || ''}">
                       <input type="hidden" name="resolver_enabled" id="hidden_resolver_enabled" value="${query.resolver_enabled || ''}">
                       <input type="hidden" name="resolver_update_interval" id="hidden_resolver_update_interval" value="${query.resolver_update_interval || ''}">
                       <input type="submit" value="Generate configuration" data-i18n="generate_config" data-i18n-value="generate_config">
                   </form>

                   <div class="bottom-buttons">
                       <button onclick="backupConfig()" data-i18n="backup">BACKUP CONFIGURATION</button>
                       <input type="file" id="restoreFile" accept=".json" style="display:none;" onchange="restoreConfig(event)">
                       <button onclick="document.getElementById('restoreFile').click()" data-i18n="restore">RESTORE CONFIGURATION</button>
                   </div>
                   <div style="margin-top: 15px; background: rgba(255,255,255,0.1); padding: 1px; border-radius: 4px;">
                       <ul style="text-align: center; margin-top: 10px;">
                           <p data-i18n="backup_note">Remember to generate the configuration before backing up</p>
                       </ul>
                   </div>
                   <div class="advanced-settings" style="margin-top: 1.25rem;">
                       <div class="advanced-settings-header" onclick="toggleSessionDetails()">
                           <strong data-i18n="session_details">Session details</strong>
                           <span id="session-details-toggle">▼</span>
                       </div>
                       <div class="advanced-settings-content" id="session-details-content">
                           <p style="margin: 0; font-size: 14px; color: #bbb;">
                               <span data-i18n="session_id">Session ID</span>: <code id="sessionIdDisplay" style="background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px; font-size: 13px;">${sessionIdDisplay}</code>
                           </p>
                       </div>
                   </div>
               </div>

               <div class="config-form" style="margin-top: 30px;">
                   <div class="advanced-settings">
                       <div class="advanced-settings-header" onclick="toggleSecuritySection()">
                           <strong data-i18n="access_security">Access & security</strong>
                           <span id="security-section-toggle">▼</span>
                       </div>
                       <div class="advanced-settings-content show" id="security-section-content">
                           <div id="homeAuthSection" style="padding-top: 0;">
                               <p style="color: #aaa; font-size: 14px; margin: 0 0 0.75rem 0;" data-i18n="protect_home_desc">If enabled, a password will be required to view this page on next visit.</p>
                               <label><input type="checkbox" id="homeAuthEnabled" ${query.homeAuthEnabled === 'true' ? 'checked' : ''}> <span data-i18n="enable_password">Enable password protection</span></label>
                               <div id="homeAuthWhenEnabled" style="margin-top: 10px; display: none;">
                                   <span style="color: #4CAF50;" data-i18n="protection_active">Protection active.</span>
                                   <button type="button" id="homeAuthEditBtn" onclick="toggleEditHomeAuth()" style="margin-left: 10px;" data-i18n="edit_password">Edit password</button>
                               </div>
                               <div id="homeAuthFields" style="margin-top: 10px; display: none;">
                                   <label data-i18n="password">Password:</label>
                                   <input type="password" id="homeAuthPassword" data-i18n-placeholder="new_password" placeholder="New password">
                                   <label data-i18n="confirm_password">Confirm password:</label>
                                   <input type="password" id="homeAuthConfirm" data-i18n-placeholder="confirm_password" placeholder="Confirm password">
                                   <button type="button" onclick="saveHomeAuth()" style="margin-top: 10px;" data-i18n="save_protection">Save protection</button>
                                   <button type="button" id="homeAuthCancelBtn" onclick="cancelEditHomeAuth()" style="margin-left: 10px; background: #666;" data-i18n="cancel">Cancel</button>
                                   <span id="homeAuthMessage" style="margin-left: 10px; font-size: 14px;"></span>
                               </div>
                           </div>
                       </div>
                   </div>
               </div>
               
               <div class="config-form" style="margin-top: 30px;">
                   <div class="advanced-settings">
                       <div class="advanced-settings-header" onclick="togglePythonSection()">
                           <strong data-i18n="python_title">Generate playlist with Python script</strong>
                           <span id="python-section-toggle">▼</span>
                       </div>
                       <div class="advanced-settings-content" id="python-section-content">
                           <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 4px; margin-bottom: 20px; margin-top: 15px;">
                               <p><strong data-i18n="python_intro">This feature allows you to:</strong></p>
                               <ul style="text-align: left;">
                                   <li data-i18n="python_desc_1">Download a Python script from a URL</li>
                                   <li data-i18n="python_desc_2">Run it inside the Docker container</li>
                                   <li data-i18n="python_desc_3">Use the generated M3U file as source</li>
                               </ul>
                               <p><strong>Note:</strong> <span data-i18n="python_note">The URL must point to a Python script that generates an M3U file.</span></p>
                           </div>
            
                           <div id="pythonForm">
                               <label data-i18n="python_script_url">Python script URL:</label>
                               <input type="url" id="pythonScriptUrl" data-i18n-placeholder="python_script_placeholder" placeholder="https://example.com/script.py">
                
                               <div style="display: flex; gap: 10px; margin-top: 15px;">
                                   <button onclick="downloadPythonScript()" style="flex: 1;" data-i18n="download_script">DOWNLOAD SCRIPT</button>
                                   <button onclick="executePythonScript()" style="flex: 1;" data-i18n="execute_script">EXECUTE SCRIPT</button>
                                   <button onclick="checkPythonStatus()" style="flex: 1;" data-i18n="check_status">CHECK STATUS</button>
                               </div>
                
                               <div style="margin-top: 15px;">
                                   <h4 data-i18n="auto_update">Automatic update</h4>
                                   <div style="display: flex; gap: 10px; align-items: center;">
                                       <input type="text" id="updateInterval" placeholder="HH:MM (e.g. 12:00)" style="flex: 2;">
                                       <button onclick="scheduleUpdates()" style="flex: 1;" data-i18n="schedule">SCHEDULE</button>
                                       <button onclick="stopScheduledUpdates()" style="flex: 1;" data-i18n="stop">STOP</button>
                                   </div>
                                   <small style="color: #999; display: block; margin-top: 5px;">
                                       Format: HH:MM (e.g. 12:00 for 12 hours, 1:00 for 1 hour, 0:30 for 30 minutes)
                                   </small>
                               </div>
                
                               <div id="pythonStatus" style="margin-top: 15px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; display: none;">
                                   <h3 data-i18n="python_status_title">Python script status</h3>
                                   <div id="pythonStatusContent"></div>
                               </div>
                
                               <div id="generatedM3uUrl" style="margin-top: 15px; background: rgba(0,255,0,0.1); padding: 10px; border-radius: 4px; display: none;">
                                   <h3 data-i18n="generated_playlist_title">Generated playlist URL</h3>
                                   <div id="m3uUrlContent"></div>
                                   <button onclick="useGeneratedM3u()" style="width: 100%; margin-top: 10px;" data-i18n="use_playlist">USE THIS PLAYLIST</button>
                               </div>
                           </div>
                       </div>
                   </div>
               </div>

               <!-- Nuova sezione per il Resolver Python -->
               <div class="config-form" style="margin-top: 30px;">
                   <div class="advanced-settings">
                       <div class="advanced-settings-header" onclick="toggleResolverSection()">
                           <strong data-i18n="resolver_title">Python Resolver for streams</strong>
                           <span id="resolver-section-toggle">▼</span>
                       </div>
                       <div class="advanced-settings-content" id="resolver-section-content">
                           <div style="margin-bottom: 1rem;">
                               <label data-i18n="resolver_script">Python Resolver script URL:</label>
                               <input type="url" id="resolverScriptUrl" value="${query.resolver_script || ''}" data-i18n-placeholder="resolver_script_placeholder" placeholder="https://example.com/resolver.py" style="width: 100%; padding: 8px; margin-bottom: 10px; border-radius: 4px; border: 1px solid #666; background: #333; color: white;">
                               <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                                   <input type="checkbox" id="resolverEnabled" ${query.resolver_enabled === 'true' ? 'checked' : ''}>
                                   <span data-i18n="resolver_enabled">Enable Python Resolver</span>
                               </label>
                           </div>
                           <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                               <p><strong data-i18n="resolver_what">What is the Python Resolver?</strong></p>
                               <p data-i18n="resolver_what_desc">The Python Resolver allows you to:</p>
                               <ul style="text-align: left;">
                                   <li data-i18n="resolver_1">Resolve streaming URLs dynamically</li>
                                   <li data-i18n="resolver_2">Add authentication tokens to streams</li>
                                   <li data-i18n="resolver_3">Handle protected APIs for content providers</li>
                                   <li data-i18n="resolver_4">Customise requests with specific headers</li>
                               </ul>
                               <p><strong>Note:</strong> <span data-i18n="resolver_note">A Python script implementing the resolve_link function is required.</span></p>
                           </div>
                       
                           <div id="resolverForm">
                       
                               <div style="display: flex; gap: 10px; margin-top: 15px;">
                                   <button onclick="downloadResolverScript()" style="flex: 1;" data-i18n="download_script">DOWNLOAD SCRIPT</button>
                                   <button onclick="createResolverTemplate()" style="flex: 1;" data-i18n="create_template">CREATE TEMPLATE</button>
                                   <button onclick="checkResolverHealth()" style="flex: 1;" data-i18n="verify_script">VERIFY SCRIPT</button>
                               </div>
                       
                               <div style="margin-top: 15px;">
                                   <h4 data-i18n="cache_updates">Cache and update management</h4>
                                   <div style="display: flex; gap: 10px; align-items: center;">
                                       <input type="text" id="resolverUpdateInterval" placeholder="HH:MM (e.g. 12:00)" style="flex: 2;">
                                       <button onclick="scheduleResolverUpdates()" style="flex: 1;" data-i18n="schedule">SCHEDULE</button>
                                       <button onclick="stopResolverUpdates()" style="flex: 1;" data-i18n="stop">STOP</button>
                                       <button onclick="clearResolverCache()" style="flex: 1;" data-i18n="clear_cache">CLEAR CACHE</button>
                                   </div>
                                   <small style="color: #999; display: block; margin-top: 5px;">
                                       Format: HH:MM (e.g. 12:00 for 12 hours, 1:00 for 1 hour, 0:30 for 30 minutes)
                                   </small>
                               </div>
                       
                               <div id="resolverStatus" style="margin-top: 15px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; display: none;">
                                   <h3 data-i18n="resolver_status_title">Python Resolver status</h3>
                                   <div id="resolverStatusContent"></div>
                               </div>
                           </div>
                       </div>
                   </div>
               </div>

               <div class="config-form" style="margin-top: 30px; text-align: center; font-size: 14px; color: #ccc;">
                   <p style="margin: 0;" data-i18n="footer_credit">Addon made with passion by McCoy88f - <a href="https://github.com/mccoy88f/OMG-Premium-TV" target="_blank">GitHub Repository</a></p>
                   <p style="margin: 12px 0 0 0;" data-i18n="support_title">Support this project!</p>
                   <p style="margin: 8px 0 0 0;">
                       <a href="https://www.buymeacoffee.com/mccoy88f" target="_blank" style="color: #8A5AAB;">Buy me a beer (Buymeacoffee)</a>
                       <span style="color: #666;"> · </span>
                       <a href="https://paypal.me/mccoy88f?country.x=IT&locale.x=it_IT" target="_blank" style="color: #8A5AAB;" data-i18n="paypal">PayPal</a>
                   </p>
                   <p style="margin: 16px 0 0 0; font-size: 12px; color: #999;">
                       <strong data-i18n="disclaimer_title">Disclaimer:</strong>
                       <span data-i18n="disclaimer_1">I am not responsible for any illegal use of this addon.</span>
                       <span data-i18n="disclaimer_2">Check and comply with the laws in your country!</span>
                   </p>
               </div>
               
               <div id="confirmModal">
                   <div>
                       <h2 data-i18n="modal_title">Installation confirmation</h2>
                       <p data-i18n="modal_question">Have you already generated the configuration?</p>
                       <div style="margin-top: 20px;">
                           <button onclick="cancelInstallation()" style="background: #666;" data-i18n="back">Back</button>
                           <button onclick="proceedInstallation()" style="background: #8A5AAB;" data-i18n="proceed">Proceed</button>
                       </div>
                   </div>
               </div>
               
               <div id="toast" class="toast" data-i18n="toast_copied">URL copied!</div>
               
               <script>
                   ${getViewScripts(protocol, host)}
               </script>
           </div>
           <div id="loaderOverlay" class="loader-overlay">
               <div class="loader"></div>
               <div id="loaderMessage" class="loader-message" data-i18n="loader_default">Processing...</div>
           </div>
       </body>
       </html>
   `;
};

module.exports = {
    renderConfigPage,
    renderGatePage
};
