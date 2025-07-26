# 📺 OMG Premium TV for Stremio

***[🇮🇹 Leggi in italiano](README.md)*** - ***[🇬🇧 Read in English](README-EN.md)*** - ***[🇫🇷 Lire en Français](README-FR.md)*** - ***[🇪🇸 Leer en español](README-ES.md)***

## 👋 Introduction

Welcome to OMG Premium TV, the Stremio addon that allows you to watch your favorite TV and IPTV channels from M3U/M3U8 playlists, enriched with program information (EPG). This guide will help you make the most of all available features.

<img width="1440" alt="Screenshot 2025-02-28 alle 21 36 52" src="https://github.com/user-attachments/assets/c85b2a33-0174-4cb3-b7a9-2cc2140c8c0f" />

### ⚠️ Please read carefully!

Working on this addon and keeping it updated has taken countless hours and dedication ❤️
A coffee ☕ or a beer 🍺 is a much appreciated gesture of recognition and helps me continue to maintain this project active!

**With a donation, you'll be added to a dedicated Telegram group where you'll receive new versions in advance! I'll be waiting for you!**

<a href="https://www.buymeacoffee.com/mccoy88f"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a beer&emoji=🍺&slug=mccoy88f&button_colour=FFDD00&font_colour=000000&font_family=Bree&outline_colour=000000&coffee_colour=ffffff" /></a>

[You can also buy me a beer with PayPal 🍻](https://paypal.me/mccoy88f?country.x=US&locale.x=en_US)

## 🔄 OMG Premium TV Changelog

### 🚀 Version 6.0.0 (Current)

### 📢 Name Rebrand
- **📜 OMG+ becomes OMG Premium**: New name to differentiate and highlight all the new available functions. OMG TV remains as the basic version with preset channels. It will no longer be updated.

### ✨ New Features
- **🐍 Python Resolver**: Complete system to resolve streaming URLs via customizable Python scripts
- **🔄 Regeneration Channel**: New channel in the ~SETTINGS~ category to regenerate the playlist without accessing the web panel
- **🛠️ Backup and Restore**: System to save and restore the complete configuration
- **🔧 Resolver Template**: Feature to automatically create customizable resolver script templates
- **👤 Advanced User-Agent**: Improved management of User-Agent, Referer, and Origin headers
- **🧩 Python Modules**: Integrated support for requests and other Python modules for advanced scripts

### 🔧 Improvements
- **🐳 Improved Docker Support**: Optimized configurations for Hugging Face and Portainer
- **♻️ Intelligent Cache**: Completely redesigned cache system with improved performance
- **🔄 Scheduled Updates**: Precise control of the update interval in HH:MM format
- **📋 Renewed Web Interface**: More intuitive configuration panel with rich features
- **⚡ Optimized Streaming**: Better management of fallback between proxy and direct streams
- **🛡️ Robust Error Handling**: Improved error handling system and multiple retry attempts

### 🐛 Fixes
- **🔄 Infinite Loop Fixed**: Fixed the infinite loop issue with resolver and proxy active
- **🔌 Improved Compatibility**: Resolved compatibility issues with different playlist types
- **🧰 HTTP Header Fix**: Fixed custom HTTP header handling
- **🔍 Channel Search Fix**: Improved channel search for partial matches
- **📊 EPG Optimization**: Resolved issues with large EPG files

## 📝 Update Notes
- Previous configurations are NOT compatible with OMG TV and OMG+ TV installations.
- It is recommended to perform a new installation from scratch on Hugging Face or VPS (Portainer recommended)
- To take advantage of Python resolver features, you need to configure it in the advanced section

For complete details on the operation of new features, consult the updated user manual.

## 🚀 Getting Started: Installation

### 🐳 Deploy on DOCKER
- To proceed, you must first install via Docker on Hugging Face or VPS.
- [Follow the guide here](docker-install-en.md) and then return to this page once your addon website is available.
- If all of this seems incomprehensible to you, STOP; look for an online guide on Docker, check the support section at the bottom of this page, or ask an AI for help 😊

### 📲 Addon Installation
1. Open the OMG Premium TV configuration web page
2. Configure the addon according to your needs
3. Click on the **INSTALL ON STREMIO** button 🔘
4. Stremio will open automatically and ask you to confirm the installation
5. Click on **Install** ✅

## ⚙️ Basic Configuration

### 📋 Playlist Configuration
- **M3U URL** 📋: Enter the URL of your M3U/M3U8 playlist
  - *Single example*: `http://example.com/playlist.m3u`
  - *Multiple example*: `http://example.com/playlist1.m3u,http://example.com/playlist2.m3u`
  - 💡 **New**: You can enter multiple M3U URLs separated by commas (,) to combine multiple playlists

### 📊 EPG Configuration
- **EPG URL** 📊: Enter the URL of the EPG file (electronic program guide)
  - *Single example*: `http://example.com/epg.xml` or `http://example.com/epg.xml.gz`
  - *Multiple example*: `http://example.com/epg1.xml,http://example.com/epg2.xml`
  - 💡 **New**: You can enter multiple EPG URLs separated by commas (,) to combine multiple program guides
- **Enable EPG** ✅: Check this box to display program information

## 🔍 Using the Addon

### 📱 Catalog Navigation
1. Open Stremio
2. Go to the **Discover** section 🔍
3. Select **TV Channels** and then **OMG Premium TV** from the addon list
4. You'll see the complete list of available channels

### 🎯 Channel Filtering
- **By genre** 🏷️: Select a genre from the dropdown menu to filter channels
- **Search** 🔍: Use the search function to find specific channels by name

### 🎬 Viewing Channel Details
Click on a channel to see:
- 📋 Channel information
- 📺 Currently airing program (if EPG enabled)
- 🕒 Upcoming programs (if EPG enabled)
- 🏷️ Channel categories

### ▶️ Channel Playback
- Click on the channel and then on the **WATCH** button ▶️
- Choose from available stream options:
  - 📺 **Original Stream**: The standard stream from the playlist
  - 🌐 **Proxy Stream**: The stream through a proxy (greater compatibility)
  - 🧩 **Resolved Stream**: The stream processed by a resolver script (for special channels)

## 🛠️ Advanced Settings

### 🌐 Proxy Configuration
- **Proxy URL** 🔗: URL of the proxy for streams (only compatible with [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy))
- **Proxy Password** 🔑: Password for proxy authentication
- **Force Proxy** ✅: Forces all streams to use the proxy

### 🆔 ID Management and Updates
- **ID Suffix** 🏷️: Adds a suffix to channel IDs without an ID in the playlist (e.g., `.it`)
- **Remapper File Path** 📝: Specify a file for EPG ID remapping
- **Update Interval** ⏱️: Specify how often to update the playlist (format `HH:MM`)

## 🐍 Advanced Python Features

### 🔄 Playlist Generation with Python Script
1. **Python Script URL** 🔗: Enter the URL of the Python script
2. **DOWNLOAD SCRIPT** 💾: Download the script to the server
3. **RUN SCRIPT** ▶️: Run the script to generate the playlist
4. **USE THIS PLAYLIST** ✅: Use the generated playlist as a source

### ⏱️ Automatic Updates
- Enter the desired interval (e.g., `12:00` for 12 hours)
- Click on **SCHEDULE** 📅 to activate automatic updates
- Click on **STOP** ⏹️ to deactivate updates

### 🧩 Python Resolver Configuration
- **Resolver Script URL** 🔗: Enter the URL of the resolver script
- **Enable Python Resolver** ✅: Activate the use of the resolver
- **DOWNLOAD SCRIPT** 💾: Download the resolver script
- **CREATE TEMPLATE** 📋: Create a customizable resolver script template
- **CHECK SCRIPT** ✅: Verify that the resolver script works correctly
- **CLEAR CACHE** 🧹: Empty the resolver cache

## 💾 Backup and Restore

### 📤 Configuration Backup
1. Click on **BACKUP CONFIGURATION** 💾
2. A JSON file will be downloaded with all your settings

### 📥 Configuration Restore
1. Click on **RESTORE CONFIGURATION** 📤
2. Select the previously saved JSON file
3. Wait for the restore to complete

## ❓ Troubleshooting

### ⚠️ Non-working Streams
- Try activating the **Force Proxy** option ✅
- Verify that the playlist URL is correct
- Try using a Python resolver script for problematic channels

### 📊 EPG Problems
- Verify that the EPG URL is correct
- Check that the **Enable EPG** option ✅ is activated
- Make sure channel IDs match between playlist and EPG

### 🐍 Python Script Problems
- Check that Python is installed on the addon server
- Check the script status in the **Python Script Status** section
- Try downloading the script again

## 🔄 Updates and Maintenance

### 🔄 Settings Modification
- In Stremio, go to **Settings** ⚙️ > **Addons**
- Click on **Configure** 🔄 next to OMG Premium TV
- Access the configuration page, make the changes you want
- Press **Generate Configuration**
- To avoid duplicates, remove the addon on Stremio
- Return to the configuration page and click **Install on Stremio**

### 🔧 Playlist Regeneration
- If you have configured a Python script, use the special **Regenerate Python Playlist** channel to recreate the playlist

## 📋 Summary of Main Features

- ✅ M3U/M3U8 playlist support
- ✅ EPG program guide support (XMLTV)
- ✅ Genre filters and search
- ✅ Proxy for greater compatibility
- ✅ Python resolver for special streams
- ✅ Custom playlist generation
- ✅ Automatic updates
- ✅ Configuration backup and restore
- TECH SPEC on [wiki](https://github.com/mccoy88f/OMG-Premium-TV/wiki/Tech-Spec-%E2%80%90-Specifiche-Teniche))


## 📱 Compatibility

OMG PremTV works on all platforms supported by Stremio:
- 💻 Windows
- 🍎 macOS
- 🐧 Linux
- 📱 Android
- 📱 iOS (via web browser)
- 📺 Android TV
- 📺 Apple TV

## 👥 Community
- If you're looking for support, guides, or information about the OMG world, MediaFlow Proxy, and Stremio, you can visit:
- [Reddit (Team Stremio Italia)](https://www.reddit.com/r/Stremio_Italia/)
- [Telegram Group (in Italian)](http:/t.me/Stremio_ITA)

## 👏 Acknowledgements
- FuriousCat for the OMG name idea
- Stremio Italia Team
- Telegram Community (see Community section)
- Iconic Panda for the [icon](https://www.flaticon.com/free-icon/tv_18223703?term=tv&page=1&position=2&origin=tag&related_id=18223703)
- [Background Video](https://it.vecteezy.com/video/1803236-no-signal-bad-tv) for the frontend and dummy streams created by igor.h (on Vecteezy)

## 📜 License
Project released under MIT license.

---

📚 **Important Note**: OMG Premium TV is designed to access legal content. No channels or streams are included in the addon. Make sure to comply with your country's regulations regarding content streaming.

🌟 Thank you for choosing OMG Premium TV! Enjoy watching! 🌟
