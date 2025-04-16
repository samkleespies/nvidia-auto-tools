# NVIDIA Auto Tools

A Windows 11 Electron app that automates NVIDIA driver installation/uninstallation and driver shader cache cleaning.

## Features

- **Driver Management:**
  - Automated NVIDIA driver uninstallation using DDU (Display Driver Uninstaller)
  - Automated NVIDIA driver installation using NVCleanInstall
  
- **Shader Cache Cleaning:**
  - Automated NVIDIA shader cache cleaning

## Prerequisites

Before using this app, you need to have installed the following:

1. **DDU (Display Driver Uninstaller)** - Download from [Guru3D](https://www.guru3d.com/files-details/display-driver-uninstaller-download.html)
2. **NVCleanInstall** - Download from [TechPowerUp](https://www.techpowerup.com/download/techpowerup-nvcleanstall/)

## Installation

### Build from source (Until I publish a release)

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the application in development mode:
   ```
   npm start
   ```
4. Build the application:
   ```
   npm run build
   ```

## Disclaimer

This application is not affiliated with NVIDIA, Display Driver Uninstaller (DDU), or NVCleanInstall. Use at your own risk. 
