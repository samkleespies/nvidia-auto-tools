# NVIDIA Driver Auto Tools

A Windows 11 Electron application that provides comprehensive tools for NVIDIA GPU management, including automated driver installation/uninstallation and shader cache cleaning.

## Features

- **Driver Management:**
  - Automated NVIDIA driver uninstallation using DDU (Display Driver Uninstaller)
  - Automated NVIDIA driver installation using NVCleanInstall
  - Support for custom NVCleanInstall configuration files
  
- **Shader Cache Cleaning:**
  - Comprehensive NVIDIA shader cache cleaning
  - Detailed logging of the cleaning process
  - Ability to save logs for troubleshooting
  
- **User-Friendly Interface:**
  - Clean, intuitive interface
  - Status updates and progress indicators
  - Detailed logging for all operations

## Prerequisites

Before using this application, you need to have the following:

1. **DDU (Display Driver Uninstaller)** - Download from [Guru3D](https://www.guru3d.com/files-details/display-driver-uninstaller-download.html)
2. **NVCleanInstall** - Download from [TechPowerUp](https://www.techpowerup.com/download/techpowerup-nvcleanstall/)
3. **Administrator privileges** on your Windows system
4. **NVIDIA GPU** installed in your system

## Installation

### Method 1: Download the installer

1. Download the latest release from the [Releases](https://github.com/yourusername/nvidia-driver-auto-tools/releases) page
2. Run the installer and follow the prompts
3. Launch the application from the Start menu

### Method 2: Build from source

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

## Usage

### Driver Management

1. Launch the application
2. Click on "Driver Installation Tools"
3. Set the path to your DDU executable
4. Set the path to your NVCleanInstall executable
5. (Optional) Set the path to your NVCleanInstall configuration file
6. Click the "Start Driver Installation Process" button
7. Follow any prompts that appear during the process

### Shader Cache Cleaning

1. Launch the application
2. Click on "Clear NVIDIA Shader Cache"
3. Click the "Start Shader Cache Cleanup" button
4. Review the detailed log of the cleaning process
5. (Optional) Save the log to a file for troubleshooting

## Important Notes

- **Save your work before starting the driver installation process** - Your display may go blank during driver uninstallation
- The application requires administrator privileges to function properly
- The application is designed for Windows systems with an NVIDIA GPU
- Neither DDU nor NVCleanInstall are included with this application - you must download them separately
- Shader cache cleaning may cause temporary stuttering in games as the cache rebuilds

## Technical Details

This application uses:
- Electron for the UI framework
- PowerShell for executing system commands
- Node.js for backend operations
- Administrator privileges to properly modify system files

## Troubleshooting

If you encounter issues:

1. Check that you have the latest versions of DDU and NVCleanInstall
2. Ensure you're running the application as Administrator
3. Check the application logs for error messages
4. Try running DDU and NVCleanInstall manually to identify any specific issues
5. For shader cache issues, you can save the log to a file and analyze it for errors

## License

[ISC License](LICENSE)

## Disclaimer

This application is not affiliated with NVIDIA, Display Driver Uninstaller (DDU), or NVCleanInstall. Use at your own risk. 