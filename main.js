const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const remote = require('@electron/remote/main');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

// Add NVIDIA driver API URL
const NVIDIA_API_URL = 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid=101&pfid=816&osID=57&languageCode=1033&beta=0&isWHQL=0&dltype=-1&dch=1&upCRD=0&qnf=0&sort1=0&numberOfResults=50';

// Initialize remote module
remote.initialize();

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'app_icon.ico')
  });

  // Enable remote module for this window
  remote.enable(mainWindow.webContents);

  mainWindow.loadFile('index.html');
  
  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers for renderer process communication
ipcMain.handle('fetch-nvidia-drivers', async () => {
  try {
    return await fetchNvidiaDriverVersions();
  } catch (error) {
    console.error('Error fetching NVIDIA drivers:', error);
    throw error;
  }
});

ipcMain.handle('download-driver', async (event, url, version) => {
  try {
    return await downloadNvidiaDriver(url, version, event);
  } catch (error) {
    console.error('Error downloading driver:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('launch-nvci-prepare', async (event, nvciPath, driverPath) => {
  try {
    return await launchNVCleanInstallPrepare(nvciPath, driverPath);
  } catch (error) {
    console.error('Error launching NVCleanInstall:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('monitor-nvci-completion', async (event) => {
  try {
    return await monitorNVCleanInstallCompletion();
  } catch (error) {
    console.error('Error monitoring NVCleanInstall completion:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('launch-ddu', async (event, dduPath) => {
  try {
    return await launchDDU(dduPath);
  } catch (error) {
    console.error('Error launching DDU:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('monitor-ddu-completion', async (event) => {
  try {
    return await monitorDDUCompletion();
  } catch (error) {
    console.error('Error monitoring DDU completion:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('install-custom-driver', async (event, customDriverPath) => {
  try {
    return await installCustomDriver(customDriverPath);
  } catch (error) {
    console.error('Error installing custom driver:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('monitor-driver-installation', async (event) => {
  try {
    return await monitorDriverInstallation();
  } catch (error) {
    console.error('Error monitoring driver installation:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('run-ddu', async (event, dduPath) => {
  try {
    return await runDDU(dduPath);
  } catch (error) {
    console.error('Error running DDU:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('run-nvcleaninstall', async (event, nvciPath, configPath) => {
  try {
    return await runNVCleanInstall(nvciPath, configPath);
  } catch (error) {
    console.error('Error running NVCleanInstall:', error);
    return { success: false, message: error.message };
  }
});

// Handler to check for existing packaged driver in Downloads
ipcMain.handle('check-existing-packaged-driver', async () => {
  try {
    const downloadsPath = app.getPath('downloads');
    console.log(`Checking for existing packaged driver in: ${downloadsPath}`);
    const files = await fs.promises.readdir(downloadsPath);
    // Look for a file starting with 'NVIDIA_Driver_' and ending with '.exe' (adjust pattern if needed)
    const driverFile = files.find(file => /^NVCleanstall_NVIDIA_.*\.exe$/i.test(file));

    if (driverFile) {
      const fullPath = path.join(downloadsPath, driverFile);
      console.log(`Found existing packaged driver: ${fullPath}`);
      return { found: true, path: fullPath, filename: driverFile };
    } else {
      console.log('No existing packaged driver found.');
      return { found: false };
    }
  } catch (error) {
    console.error('Error checking for existing packaged driver:', error);
    // Return found: false in case of error to avoid blocking the process
    return { found: false, error: error.message };
  }
});

ipcMain.handle('clear-shader-cache', async (event) => {
  try {
    return await clearNvidiaShaderCache();
  } catch (error) {
    console.error('Error clearing shader cache:', error);
    return { success: false, message: error.message };
  }
});

// Add a new IPC handler for integrated shader cache clearing
ipcMain.handle('clear-shader-cache-integrated', async (event) => {
  try {
    return await clearShaderCacheIntegrated(event);
  } catch (error) {
    console.error('Error in integrated shader cache clearing:', error);
    return { success: false, message: error.message, log: [] };
  }
});

// Add a handler for computer restart
ipcMain.handle('restart-computer', async () => {
  return new Promise((resolve, reject) => {
    const ps = new PowerShell({
      executionPolicy: 'Bypass',
      noProfile: true
    });
    
    ps.addCommand(`
      try {
        Write-Output "Initiating system restart..."
        # Give a 5-second delay before restarting
        Start-Process -FilePath "shutdown.exe" -ArgumentList "/r", "/t", "5", "/c", "'NVIDIA Driver Auto Tools: Restart to complete driver installation'" -Wait
        Write-Output "Restart command issued successfully"
      } catch {
        Write-Error "Failed to initiate restart: $_"
        exit 1
      }
    `);
    
    ps.invoke()
      .then(output => {
        console.log('Restart command execution output:', output);
        ps.dispose();
        
        if (output && output.includes('Failed to initiate restart')) {
          reject(new Error('Failed to initiate system restart'));
        } else {
          resolve({ success: true, message: 'Restart initiated' });
        }
      })
      .catch(err => {
        console.error('Error initiating restart:', err);
        ps.dispose();
        reject(new Error(`Failed to restart: ${err.message}`));
      });
  });
});

// Function to fetch NVIDIA driver versions
async function fetchNvidiaDriverVersions() {
  return new Promise((resolve, reject) => {
    https.get(NVIDIA_API_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch driver versions: HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (!response.IDS || !response.IDS.length) {
            reject(new Error('No driver versions found in response'));
            return;
          }

          // Helper function to find date fields in an object recursively
          function findDateFieldsRecursively(obj, path = '', results = {}) {
            if (!obj || typeof obj !== 'object') return results;
            
            for (const key in obj) {
              const value = obj[key];
              const newPath = path ? `${path}.${key}` : key;
              
              // Check if the key might contain date information
              if (typeof value === 'string' && (
                  key.toLowerCase().includes('date') || 
                  key.toLowerCase().includes('release') || 
                  key.toLowerCase().includes('time'))
              ) {
                // Try to parse it as a date to see if it's valid
                const dateObj = new Date(value);
                if (!isNaN(dateObj) && dateObj.getFullYear() >= 2000) {
                  results[newPath] = {
                    value,
                    dateObj,
                    formatted: dateObj.toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric'
                    })
                  };
                }
              }
              
              // Recursively search in nested objects
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                findDateFieldsRecursively(value, newPath, results);
              }
            }
            
            return results;
          }

          // Debug: Log date fields from the first driver to help diagnose date issues
          if (response.IDS.length > 0) {
            const firstDriver = response.IDS[0];
            console.log('DEBUG - Date fields in first driver:');
            console.log('Driver Version:', firstDriver.downloadInfo?.Version);
            console.log('releaseDateTime:', firstDriver.downloadInfo?.releaseDateTime);
            console.log('publishedDate:', firstDriver.downloadInfo?.publishedDate);
            console.log('release_date:', firstDriver.downloadInfo?.release_date);
            
            // Search for all potential date fields
            const allDateFields = findDateFieldsRecursively(firstDriver);
            console.log('All potential date fields found:', allDateFields);
          }
          
          // Process driver versions
          const driverVersions = response.IDS.map(driver => {
            // Parse the date from the correct location in the API response
            let releaseDate = null;
            
            // Use our helper function to find all date fields
            const dateFields = findDateFieldsRecursively(driver);
            
            // Preferred order of date fields to use (most to least preferred)
            const dateFieldPriority = [
              'downloadInfo.publishedDate',
              'downloadInfo.releaseDateTime',
              'downloadInfo.release_date',
              'downloadInfo.date',
              'downloadInfo.ReleaseDate'
            ];
            
            // Try to find a date using our priority list
            for (const fieldPath of dateFieldPriority) {
              if (dateFields[fieldPath]) {
                releaseDate = dateFields[fieldPath].dateObj;
                console.log(`Using date from ${fieldPath} for driver ${driver.downloadInfo.Version}`);
                break;
              }
            }
            
            // If no date found from priority list, use the first valid date we found
            if (!releaseDate && Object.keys(dateFields).length > 0) {
              const firstDateField = Object.keys(dateFields)[0];
              releaseDate = dateFields[firstDateField].dateObj;
              console.log(`Using first found date from ${firstDateField} for driver ${driver.downloadInfo.Version}`);
            }
            
            // Fallback to the original approach if our recursive search failed
            if (!releaseDate) {
              // First try the direct releaseDateTime field
              if (driver.downloadInfo && driver.downloadInfo.releaseDateTime) {
                releaseDate = new Date(driver.downloadInfo.releaseDateTime);
              } 
              // Then check the publishedDate field which is often more reliable
              else if (driver.downloadInfo && driver.downloadInfo.publishedDate) {
                releaseDate = new Date(driver.downloadInfo.publishedDate);
              }
              // Finally check for release date in other locations where it might exist
              else if (driver.downloadInfo && driver.downloadInfo.release_date) {
                releaseDate = new Date(driver.downloadInfo.release_date);
              }
            }
            
            let formattedDate = 'Unknown date';
            // Verify that we have a valid date object before formatting
            if (releaseDate instanceof Date && !isNaN(releaseDate)) {
              formattedDate = releaseDate.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric'
              });
            } else {
              console.log(`Invalid date for driver ${driver.downloadInfo.Version}: ${JSON.stringify(driver.downloadInfo)}`);
            }
              
            return {
              id: driver.downloadInfo.id,
              version: driver.downloadInfo.Version,
              name: driver.displayName || 'NVIDIA GeForce Driver',
              url: `https://us.download.nvidia.com/Windows/${driver.downloadInfo.Version}/${driver.downloadInfo.Version}-desktop-win10-win11-64bit-international-dch-whql.exe`,
              size: driver.downloadInfo.downloadSize || 'Unknown size',
              releaseDate: formattedDate,
              rawDate: releaseDate instanceof Date && !isNaN(releaseDate) ? releaseDate.getTime() : 0 // For sorting
            };
          });
          
          // Sort by version number (newest first)
          driverVersions.sort((a, b) => {
            // First try to compare by version number
            const versionA = a.version.split('.').map(Number);
            const versionB = b.version.split('.').map(Number);
            
            for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
              const numA = i < versionA.length ? versionA[i] : 0;
              const numB = i < versionB.length ? versionB[i] : 0;
              
              if (numA !== numB) {
                return numB - numA; // Descending order
              }
            }
            
            // If versions are identical, sort by date
            return b.rawDate - a.rawDate;
          });
          
          resolve(driverVersions);
        } catch (error) {
          reject(new Error(`Failed to parse driver versions: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to fetch driver versions: ${error.message}`));
    });
  });
}

// Function to download NVIDIA driver
async function downloadNvidiaDriver(url, version, event) {
  return new Promise((resolve, reject) => {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const fileName = `NVIDIA-${version}.exe`;
    const filePath = path.join(downloadsPath, fileName);
    const fileStream = fs.createWriteStream(filePath);
    
    console.log(`Downloading driver from ${url} to ${filePath}`);
    
    const protocol = url.startsWith('https') ? https : http;
    
    // Variables for progress tracking and throttling
    let downloadedSize = 0;
    let totalSize = 0;
    let lastProgressUpdate = 0;
    let progressUpdateInterval = 100; // Update UI at most every 100ms
    let lastPercentage = 0;
    
    const sendProgressUpdate = (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressUpdate < progressUpdateInterval) {
        return;
      }
      
      if (event && totalSize) {
        const percentage = downloadedSize / totalSize;
        // Only send update if percentage changed by at least 0.5% or if forced
        if (force || Math.abs(percentage - lastPercentage) >= 0.005) {
          event.sender.send('download-progress', percentage);
          lastPercentage = percentage;
          lastProgressUpdate = now;
        }
      }
    };
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        fileStream.close();
        fs.unlink(filePath, () => {}); // Clean up partial file
        reject(new Error(`Failed to download driver: HTTP ${response.statusCode}`));
        return;
      }
      
      totalSize = parseInt(response.headers['content-length'], 10);
      console.log(`Total file size: ${totalSize} bytes`);
      
      // Send initial progress
      if (event) {
        event.sender.send('download-progress', 0);
      }
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        fileStream.write(chunk);
        
        // Send throttled progress updates to renderer
        sendProgressUpdate();
      });
      
      response.on('end', () => {
        fileStream.end();
        
        // Send final progress update
        sendProgressUpdate(true);
        
        console.log(`Driver downloaded to ${filePath}`);
        resolve({ success: true, filePath });
      });
      
    }).on('error', (error) => {
      fileStream.close();
      fs.unlink(filePath, () => {}); // Clean up partial file
      reject(new Error(`Failed to download driver: ${error.message}`));
    });
  });
}

// Function to position the main app window and NVCleanInstall window side by side
function positionWindowsSideBySide() {
  if (!mainWindow) return;
  
  // Use built-in Electron APIs to get information about our window and screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Get current position and size of our app window without changing it
  const appBounds = mainWindow.getBounds();
  const appWidth = appBounds.width;
  const appHeight = appBounds.height;
  const appLeft = appBounds.x;
  
  // Calculate right edge of our app window
  const rightStart = appLeft + appWidth;
  
  // Log current window position for debugging
  console.log(`Current app window: X=${appLeft}, Y=${appBounds.y}, Width=${appWidth}, Height=${appHeight}`);
  console.log(`Will position NVCleanInstall directly to the right at X=${rightStart}`);
  
  // Use exec to run a powershell command to find and position the NVCleanInstall window
  try {
    const { exec } = require('child_process');
    
    // Improved PowerShell script with better window detection and error handling
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        
        public class Window {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
          
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }
          
          public const int SW_RESTORE = 9;
          public const int SW_NORMAL = 1;
        }
"@
      
      # Get screen dimensions
      $screenWidth = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width
      $screenHeight = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height
      
      # Our app's current position and dimensions (DO NOT MODIFY THESE)
      $appLeft = ${appLeft}
      $appTop = ${appBounds.y}
      $appWidth = ${appWidth}
      $appHeight = ${appHeight}
      
      # Calculate where to place NVCleanInstall window (directly to the right)
      $nvciLeft = $appLeft + $appWidth + 10  # 10px spacing between windows
      $nvciTop = $appTop
      
      # Set dimensions for NVCleanInstall window
      $nvciWidth = [math]::Min(800, $screenWidth - $nvciLeft - 20)  # Keep 20px from right edge of screen
      $nvciHeight = $appHeight
      
      Write-Host "Screen dimensions: $screenWidth x $screenHeight"
      Write-Host "App window: Left=$appLeft, Top=$appTop, Width=$appWidth, Height=$appHeight"
      Write-Host "Target NVCleanInstall position: Left=$nvciLeft, Top=$nvciTop, Width=$nvciWidth, Height=$nvciHeight"
      
      # More aggressive search for the NVCleanInstall window
      $nvciProcesses = @(
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*NVCleanstall*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*NVIDIA*" -and $_.MainWindowTitle -like "*Clean*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.ProcessName -like "*NVCleanstall*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.ProcessName -like "*TechPowerUp*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.MainWindowTitle -notlike "*NVIDIA Driver Auto Tools*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1)
      ) | Where-Object { $_ -ne $null } | Select-Object -First 1
      
      if ($nvciProcesses) {
        $nvciProcess = $nvciProcesses
        
        # Log what we found
        Write-Host "Found NVCleanInstall window with title: $($nvciProcess.MainWindowTitle)"
        Write-Host "Process name: $($nvciProcess.ProcessName), ID: $($nvciProcess.Id)"
        
        # Get current window dimensions before modifying
        $rect = New-Object Window+RECT
        [Window]::GetWindowRect($nvciProcess.MainWindowHandle, [ref]$rect)
        $currentWidth = $rect.Right - $rect.Left
        $currentHeight = $rect.Bottom - $rect.Top
        Write-Host "Current window size: ${currentWidth}x${currentHeight} at position ($($rect.Left),$($rect.Top))"
        
        # Make sure the window is not minimized and bring it to front
        [Window]::ShowWindow($nvciProcess.MainWindowHandle, [Window]::SW_RESTORE)
        [Window]::ShowWindow($nvciProcess.MainWindowHandle, [Window]::SW_NORMAL)
        
        # If NVCleanInstall would go off the right edge of the screen, adjust its width
        if ($nvciLeft + $nvciWidth -gt $screenWidth) {
          $nvciWidth = $screenWidth - $nvciLeft - 10
          Write-Host "Adjusted width to $nvciWidth to fit on screen"
        }
        
        # Position NVCleanInstall on the right without moving our app
        Write-Host "Positioning NVCleanInstall to: X=$nvciLeft, Y=$nvciTop, Width=$nvciWidth, Height=$nvciHeight"
        [Window]::MoveWindow($nvciProcess.MainWindowHandle, $nvciLeft, $nvciTop, $nvciWidth, $nvciHeight, $true)
        
        # Log that we positioned it
        Write-Host "Positioned NVCleanInstall window to the right of app"
        
        # Bring it to front
        [Window]::SetForegroundWindow($nvciProcess.MainWindowHandle)
        
        # Wait briefly and attempt to position it again to make sure it works
        Start-Sleep -Milliseconds 200
        [Window]::MoveWindow($nvciProcess.MainWindowHandle, $nvciLeft, $nvciTop, $nvciWidth, $nvciHeight, $true)
        
        # Final position check to ensure it worked
        [Window]::GetWindowRect($nvciProcess.MainWindowHandle, [ref]$rect)
        Write-Host "Final position: ($($rect.Left),$($rect.Top)) Size: $(($rect.Right-$rect.Left))x$(($rect.Bottom-$rect.Top))"
      } else {
        Write-Host "Warning: No NVCleanInstall window found in the first search"
        
        # Last resort - look for any non-electron window that was recently opened
        $recentProcess = Get-Process | Where-Object { 
          $_.MainWindowHandle -ne 0 -and 
          $_.MainWindowTitle -ne "" -and
          $_.MainWindowTitle -notlike "*NVIDIA Driver Auto Tools*" -and
          $_.ProcessName -notlike "electron*"
        } | Sort-Object StartTime -Descending | Select-Object -First 1
        
        if ($recentProcess) {
          Write-Host "Found recently opened window: $($recentProcess.MainWindowTitle)"
          Write-Host "Positioning to: X=$nvciLeft, Y=$nvciTop, Width=$nvciWidth, Height=$nvciHeight"
          [Window]::MoveWindow($recentProcess.MainWindowHandle, $nvciLeft, $nvciTop, $nvciWidth, $nvciHeight, $true)
          [Window]::ShowWindow($recentProcess.MainWindowHandle, [Window]::SW_NORMAL)
          [Window]::SetForegroundWindow($recentProcess.MainWindowHandle)
          Write-Host "Positioned recently opened window as fallback"
        } else {
          Write-Host "Could not find any suitable window to position"
        }
      }
    `;
    
    // Execute PowerShell script as a shell command
    exec(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error positioning NVCleanInstall window: ${error.message}`);
        return;
      }
      console.log(`NVCleanInstall window positioning output: ${stdout}`);
    });
    
    // No need to refocus our app window since we want NVCleanInstall to be in front
  } catch (error) {
    console.error('Error in window positioning:', error);
  }
}

// No need to modify positionAppWindowLeft function - in fact we shouldn't use it at all

// Function to launch NVCleanInstall for package preparation
async function launchNVCleanInstallPrepare(nvciPath, driverPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(nvciPath)) {
      reject(new Error(`NVCleanInstall executable not found at path: ${nvciPath}`));
      return;
    }
    
    if (!fs.existsSync(driverPath)) {
      reject(new Error(`Driver file not found at path: ${driverPath}`));
      return;
    }
    
    console.log(`Launching NVCleanInstall with driver: ${driverPath}`);
    
    try {
      // Don't position the app window - leave it where it is
      
      // Launch NVCleanInstall with the driver file
      const process = spawn(nvciPath, [driverPath], {
        detached: true,
        stdio: 'ignore'
      });
      
      // Don't wait for process to exit
      process.unref();
      
      // Position the windows side by side with increased delay
      // to ensure NVCleanInstall has enough time to initialize
      setTimeout(() => {
        console.log('First positioning attempt for NVCleanInstall window...');
        positionWindowsSideBySide();
      }, 1000);
      
      // Make multiple positioning attempts to ensure windows are arranged properly
      setTimeout(() => {
        console.log('Second positioning attempt for NVCleanInstall window...');
        positionWindowsSideBySide();
      }, 2000);
      
      setTimeout(() => {
        console.log('Final positioning attempt for NVCleanInstall window...');
        positionWindowsSideBySide();
      }, 3500);
      
      resolve({
        success: true,
        processId: process.pid,
        message: 'NVCleanInstall launched successfully'
      });
    } catch (error) {
      reject(new Error(`Failed to launch NVCleanInstall: ${error.message}`));
    }
  });
}

// Function to monitor NVCleanInstall completion
async function monitorNVCleanInstallCompletion() {
  return new Promise((resolve, reject) => {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const customInstallerPattern = /.*NVCleanstall_.*\.exe$/i;
    
    let attempts = 0;
    const maxAttempts = 180; // 15 minutes at 5-second intervals
    
    const checkForCustomInstaller = () => {
      attempts++;
      
      if (attempts > maxAttempts) {
        reject(new Error('Timed out waiting for NVCleanInstall to create custom package'));
        return;
      }
      
      try {
        // Look for a new NVCleanstall installer in Downloads
        const files = fs.readdirSync(downloadsPath);
        
        // Filter and sort by creation time, newest first
        const customInstallers = files
          .filter(file => customInstallerPattern.test(file))
          .map(file => {
            const filePath = path.join(downloadsPath, file);
            const stats = fs.statSync(filePath);
            return { 
              name: file, 
              path: filePath, 
              ctime: stats.ctime 
            };
          })
          .sort((a, b) => b.ctime - a.ctime); // Newest first
        
        if (customInstallers.length > 0) {
          // Found a custom installer, check if it was created in the last minute
          const newestInstaller = customInstallers[0];
          const ageInSeconds = (Date.now() - newestInstaller.ctime) / 1000;
          
          if (ageInSeconds < 60) { // Created in the last minute
            resolve({
              success: true,
              driverPath: newestInstaller.path,
              message: 'Custom driver package created'
            });
            return;
          }
        }
        
        // No new installer found, continue checking
        setTimeout(checkForCustomInstaller, 5000);
      } catch (error) {
        console.error('Error checking for custom installer:', error);
        // Don't fail, just continue checking
        setTimeout(checkForCustomInstaller, 5000);
      }
    };
    
    // Start checking
    checkForCustomInstaller();
  });
}

// Function to launch DDU
async function launchDDU(dduPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dduPath)) {
      reject(new Error(`DDU executable not found at path: ${dduPath}`));
      return;
    }
    
    console.log(`Launching DDU: ${dduPath}`);
    
    try {
      // Launch DDU
      const process = spawn(dduPath, [], {
        detached: true,
        stdio: 'ignore'
      });
      
      // Don't wait for process to exit
      process.unref();
      
      // Position the windows side by side after a delay to allow DDU to initialize
      setTimeout(() => {
        positionDDUWindowsSideBySide();
      }, 2000);
      
      resolve({
        success: true,
        processId: process.pid,
        message: 'DDU launched successfully'
      });
    } catch (error) {
      reject(new Error(`Failed to launch DDU: ${error.message}`));
    }
  });
}

// Function to position the main app window and DDU window side by side
function positionDDUWindowsSideBySide() {
  if (!mainWindow) return;
  
  // Use built-in Electron APIs to get information about our window and screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Get current position and size of our app window without changing it
  const appBounds = mainWindow.getBounds();
  const appWidth = appBounds.width;
  const appHeight = appBounds.height;
  const appLeft = appBounds.x;
  
  // Calculate right edge for DDU window position
  const dduLeft = appLeft + appWidth + 10; // 10px spacing between windows
  
  // Log current window position for debugging
  console.log(`Current app window: X=${appLeft}, Y=${appBounds.y}, Width=${appWidth}, Height=${appHeight}`);
  console.log(`Will position DDU window to the right at X=${dduLeft}`);
  
  // Use exec to run a powershell command to find and position the DDU window
  try {
    const { exec } = require('child_process');
    
    // PowerShell script for DDU window positioning
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        
        public class Window {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
          
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }
          
          public const int SW_RESTORE = 9;
          public const int SW_NORMAL = 1;
        }
"@
      
      # Get screen dimensions
      $screenWidth = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width
      $screenHeight = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height
      
      # Our app's current position and dimensions
      $appLeft = ${appLeft}
      $appTop = ${appBounds.y}
      $appWidth = ${appWidth}
      $appHeight = ${appHeight}
      
      # Calculate where to place the DDU window
      $dduLeft = $appLeft + $appWidth + 10  # 10px spacing
      $dduTop = $appTop
      $dduWidth = [math]::Min(800, $screenWidth - $dduLeft - 20) # Keep 20px from right edge
      $dduHeight = $appHeight
      
      Write-Host "Screen dimensions: $screenWidth x $screenHeight"
      Write-Host "App window: Left=$appLeft, Top=$appTop, Width=$appWidth, Height=$appHeight"
      Write-Host "Target DDU position: Left=$dduLeft, Top=$dduTop, Width=$dduWidth, Height=$dduHeight"
      
      # Try several possible window titles for DDU with enhanced detection
      $dduProcesses = @(
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*Display Driver Uninstaller*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*DDU*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.ProcessName -like "*DDU*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.ProcessName -like "*Display*" -and $_.ProcessName -like "*Driver*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.MainWindowTitle -notlike "*NVIDIA Driver Auto Tools*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1)
      ) | Where-Object { $_ -ne $null } | Select-Object -First 1
      
      if ($dduProcesses) {
        $dduProcess = $dduProcesses
        
        # Log what we found
        Write-Host "Found DDU window with title: $($dduProcess.MainWindowTitle)"
        Write-Host "Process name: $($dduProcess.ProcessName), ID: $($dduProcess.Id)"
        
        # Get current window dimensions before modifying
        $rect = New-Object Window+RECT
        [Window]::GetWindowRect($dduProcess.MainWindowHandle, [ref]$rect)
        $currentWidth = $rect.Right - $rect.Left
        $currentHeight = $rect.Bottom - $rect.Top
        Write-Host "Current window size: ${currentWidth}x${currentHeight} at position ($($rect.Left),$($rect.Top))"
        
        # Make sure the window is not minimized and bring it to front
        [Window]::ShowWindow($dduProcess.MainWindowHandle, [Window]::SW_RESTORE)
        [Window]::ShowWindow($dduProcess.MainWindowHandle, [Window]::SW_NORMAL)
        
        # If DDU would go off the right edge of the screen, adjust its width
        if ($dduLeft + $dduWidth -gt $screenWidth) {
          $dduWidth = $screenWidth - $dduLeft - 10
          Write-Host "Adjusted width to $dduWidth to fit on screen"
        }
        
        # Position DDU on the right without moving our app
        Write-Host "Positioning DDU to: X=$dduLeft, Y=$dduTop, Width=$dduWidth, Height=$dduHeight"
        [Window]::MoveWindow($dduProcess.MainWindowHandle, $dduLeft, $dduTop, $dduWidth, $dduHeight, $true)
        
        # Log that we positioned it
        Write-Host "Positioned DDU window to the right of app"
        
        # Bring DDU to front
        [Window]::SetForegroundWindow($dduProcess.MainWindowHandle)
        
        # Final position check to ensure it worked
        [Window]::GetWindowRect($dduProcess.MainWindowHandle, [ref]$rect)
        Write-Host "Final position: ($($rect.Left),$($rect.Top)) Size: $(($rect.Right-$rect.Left))x$(($rect.Bottom-$rect.Top))"
      } else {
        Write-Host "Warning: No DDU window found"
      }
    `;
    
    // Execute PowerShell script as a shell command
    exec(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error positioning DDU window: ${error.message}`);
        return;
      }
      console.log(`DDU window positioning output: ${stdout}`);
    });
    
    // No need to refocus our app window
  } catch (error) {
    console.error('Error in DDU window positioning:', error);
  }
}

// Function to monitor DDU completion
async function monitorDDUCompletion() {
  return new Promise((resolve, reject) => {
    console.log('Monitoring for DDU completion...');

    let attempts = 0;
    const maxAttempts = 180; // 15 minutes at 5-second intervals
    const dduCheckInterval = 5000; // 5 seconds
    const initialDelay = 10000; // 10 seconds

    const checkForDDUCompletion = () => {
      attempts++;

      if (attempts > maxAttempts) {
        reject(new Error('Timed out waiting for DDU to complete'));
        return;
      }

      // Use exec with PowerShell command to check for DDU process
      const dduCheckCommand = `powershell -command "$dduProcess = Get-Process | Where-Object { $_.Name -like '*Display Driver Uninstaller*' -or $_.Name -like '*DDU*' } | Select-Object -First 1; if ($dduProcess) { exit 1 } else { exit 0 }"`;

      exec(dduCheckCommand, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 1) {
            // DDU is still running (exit code 1 means process found)
            console.log('DDU is still running, checking again in 5s...');
            setTimeout(checkForDDUCompletion, dduCheckInterval);
          } else {
            // Unexpected error checking DDU status
            console.error(`Error checking DDU status (Code: ${error.code}):`, stderr || error.message);
            // Continue checking despite the error, as DDU might still finish
            setTimeout(checkForDDUCompletion, dduCheckInterval);
          }
        } else {
          // DDU has completed (exit code 0 means process not found)
          console.log('DDU process has completed.');

          // Check if a reboot is pending
          const rebootCheckCommand = `powershell -command "$pendingReboot = Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\PendingFileRenameOperations'; if ($pendingReboot) { exit 2 } else { exit 0 }"`;

          exec(rebootCheckCommand, (rebootError, rebootStdout, rebootStderr) => {
            if (rebootError) {
              if (rebootError.code === 2) {
                // Reboot is pending (exit code 2)
                console.log('Reboot is pending after DDU completion.');
                resolve({
                  success: true,
                  rebootNeeded: true,
                  message: 'DDU completed but system needs to reboot before continuing'
                });
              } else {
                // Unexpected error checking reboot status
                console.error(`Error checking for pending reboot (Code: ${rebootError.code}):`, rebootStderr || rebootError.message);
                // Resolve successfully but indicate uncertainty about reboot
                 resolve({
                   success: true,
                   rebootNeeded: undefined, // Indicate unknown reboot status due to error
                   message: 'DDU completed, but failed to check reboot status.'
                 });
              }
            } else {
              // No reboot pending (exit code 0)
              console.log('No reboot pending after DDU completion.');
              resolve({
                success: true,
                rebootNeeded: false,
                message: 'DDU completed successfully'
              });
            }
          });
        }
      });
    };

    // Start checking after initial delay
    setTimeout(checkForDDUCompletion, initialDelay);
  });
}

// Function to install custom driver
async function installCustomDriver(customDriverPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(customDriverPath)) {
      reject(new Error(`Custom driver installer not found at path: ${customDriverPath}`));
      return;
    }
    
    console.log(`Installing custom driver: ${customDriverPath}`);
    
    try {
      // Launch the installer
      const process = spawn(customDriverPath, ['/s'], { // Silent install
        detached: true,
        stdio: 'ignore'
      });
      
      // Don't wait for process to exit
      process.unref();
      
      // Position the windows side by side after a delay to allow installer to initialize
      setTimeout(() => {
        positionInstallerWindowsSideBySide();
      }, 3000); // Slightly longer delay for installer which may take longer to show a window
      
      resolve({
        success: true,
        processId: process.pid,
        message: 'Custom driver installation started'
      });
    } catch (error) {
      reject(new Error(`Failed to start driver installation: ${error.message}`));
    }
  });
}

// Function to position the main app window and driver installer window side by side
function positionInstallerWindowsSideBySide() {
  if (!mainWindow) return;
  
  // Use built-in Electron APIs to get information about our window and screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Get current position and size of our app window without changing it
  const appBounds = mainWindow.getBounds();
  const appWidth = appBounds.width;
  const appHeight = appBounds.height;
  const appLeft = appBounds.x;
  
  // Calculate right edge for installer window position
  const installerLeft = appLeft + appWidth + 10; // 10px spacing between windows
  
  // Log current window position for debugging
  console.log(`Current app window: X=${appLeft}, Y=${appBounds.y}, Width=${appWidth}, Height=${appHeight}`);
  console.log(`Will position installer window to the right at X=${installerLeft}`);
  
  // Use exec to run a powershell command to find and position the installer window
  try {
    const { exec } = require('child_process');
    
    // PowerShell script for installer window positioning
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        
        public class Window {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
          
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }
          
          public const int SW_RESTORE = 9;
          public const int SW_NORMAL = 1;
        }
"@
      
      # Get screen dimensions
      $screenWidth = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width
      $screenHeight = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height
      
      # Our app's current position and dimensions
      $appLeft = ${appLeft}
      $appTop = ${appBounds.y}
      $appWidth = ${appWidth}
      $appHeight = ${appHeight}
      
      # Calculate where to place installer window
      $installerLeft = $appLeft + $appWidth + 10  # 10px spacing
      $installerTop = $appTop
      $installerWidth = [math]::Min(800, $screenWidth - $installerLeft - 20) # Keep 20px from right edge
      $installerHeight = $appHeight
      
      Write-Host "Screen dimensions: $screenWidth x $screenHeight"
      Write-Host "App window: Left=$appLeft, Top=$appTop, Width=$appWidth, Height=$appHeight"
      Write-Host "Target installer position: Left=$installerLeft, Top=$installerTop, Width=$installerWidth, Height=$installerHeight"
      
      # Try to find any NVIDIA installer window with enhanced detection
      $installerProcesses = @(
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*NVIDIA*" -and $_.MainWindowTitle -like "*install*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*NVIDIA*" -and $_.MainWindowTitle -like "*setup*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -like "*NVIDIA*" -and $_.MainWindowTitle -notlike "*NVIDIA Driver Auto Tools*" } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.ProcessName -like "*setup*" -or $_.ProcessName -like "*install*" -or $_.ProcessName -like "*nvidia*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1),
        (Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.MainWindowTitle -notlike "*NVIDIA Driver Auto Tools*" } | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1)
      ) | Where-Object { $_ -ne $null } | Select-Object -First 1
      
      # If an installer window was found
      if ($installerProcesses) {
        $installerProcess = $installerProcesses
        
        # Log what we found
        Write-Host "Found installer window: $($installerProcess.MainWindowTitle)"
        Write-Host "Process name: $($installerProcess.ProcessName), ID: $($installerProcess.Id)"
        
        # Get current window dimensions before modifying
        $rect = New-Object Window+RECT
        [Window]::GetWindowRect($installerProcess.MainWindowHandle, [ref]$rect)
        $currentWidth = $rect.Right - $rect.Left
        $currentHeight = $rect.Bottom - $rect.Top
        Write-Host "Current window size: ${currentWidth}x${currentHeight} at position ($($rect.Left),$($rect.Top))"
        
        # Make sure the window is not minimized and bring it to front
        [Window]::ShowWindow($installerProcess.MainWindowHandle, [Window]::SW_RESTORE)
        [Window]::ShowWindow($installerProcess.MainWindowHandle, [Window]::SW_NORMAL)
        
        # If installer would go off the right edge of the screen, adjust its width
        if ($installerLeft + $installerWidth -gt $screenWidth) {
          $installerWidth = $screenWidth - $installerLeft - 10
          Write-Host "Adjusted width to $installerWidth to fit on screen"
        }
        
        # Position installer window on the right without moving our app
        Write-Host "Positioning installer to: X=$installerLeft, Y=$installerTop, Width=$installerWidth, Height=$installerHeight"
        [Window]::MoveWindow($installerProcess.MainWindowHandle, $installerLeft, $installerTop, $installerWidth, $installerHeight, $true)
        
        # Log that we positioned it
        Write-Host "Positioned installer window to the right of app"
        
        # Bring installer to front
        [Window]::SetForegroundWindow($installerProcess.MainWindowHandle)
        
        # Final position check to ensure it worked
        [Window]::GetWindowRect($installerProcess.MainWindowHandle, [ref]$rect)
        Write-Host "Final position: ($($rect.Left),$($rect.Top)) Size: $(($rect.Right-$rect.Left))x$(($rect.Bottom-$rect.Top))"
      } else {
        Write-Host "Warning: No installer window found"
      }
    `;
    
    // Execute PowerShell script as a shell command
    exec(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error positioning installer window: ${error.message}`);
        return;
      }
      console.log(`Installer window positioning output: ${stdout}`);
    });
    
    // No need to refocus our app window
  } catch (error) {
    console.error('Error in installer window positioning:', error);
  }
}

// Function to monitor driver installation
async function monitorDriverInstallation() {
  return new Promise((resolve, reject) => {
    console.log('Monitoring for driver installation completion...');

    let attempts = 0;
    const maxAttempts = 120; // 20 minutes at 10-second intervals
    const checkInterval = 10000; // 10 seconds

    const checkForInstallCompletion = () => {
      attempts++;

      if (attempts > maxAttempts) {
        reject(new Error('Timed out waiting for driver installation to complete'));
        return;
      }

      // Use exec with PowerShell command to check for NVIDIA installer processes and driver status
      const installCheckCommand = `powershell -command "
        $installerProcesses = Get-Process | Where-Object {
          $_.Name -like '*nvidia*' -and
          ($_.Name -like '*setup*' -or $_.Name -like '*install*' -or $_.Name -like '*NVCleanstall*')
        };
        
        if ($installerProcesses) {
          exit 1 # Still running
        } else {
          # Check if any NVIDIA display driver is installed now
          $nvDisplay = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -like '*NVIDIA*' };
          if ($nvDisplay) {
            exit 0 # Completed successfully
          } else {
            exit 2 # Completed, but no driver detected (needs reboot?)
          }
        }
      "`;

      exec(installCheckCommand, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 1) {
            // Installation still in progress (exit code 1)
            console.log('NVIDIA installer process still running, checking again in 10s...');
            setTimeout(checkForInstallCompletion, checkInterval);
          } else if (error.code === 2) {
            // Installation finished, but no driver detected (exit code 2)
            console.log('NVIDIA installer process finished, but no driver detected (reboot likely needed).');
             resolve({
               success: true, // Consider it success in terms of the installer finishing
               rebootNeeded: true, // Indicate reboot is likely needed
               message: 'Driver installation process finished, but a reboot may be required to finalize.'
             });
          } else {
            // Unexpected error checking install status
            console.error(`Error checking installation status (Code: ${error.code}):`, stderr || error.message);
            // Continue checking despite the error
            setTimeout(checkForInstallCompletion, checkInterval);
          }
        } else {
          // Installation completed successfully (exit code 0)
          console.log('NVIDIA installer process finished and driver detected.');
          resolve({
            success: true,
            rebootNeeded: false,
            message: 'Driver installation completed successfully'
          });
        }
      });
    };

    // Start checking after initial delay
    setTimeout(checkForInstallCompletion, checkInterval); // Wait 10 seconds before first check
  });
}

// Function to run DDU
async function runDDU(dduPath) {
  return new Promise((resolve, reject) => {
    // Validate the path exists before attempting to run
    if (!fs.existsSync(dduPath)) {
      return reject(new Error(`DDU executable not found at path: ${dduPath}`));
    }

    console.log(`Starting DDU from path: ${dduPath}`);
    
    // Create a new PowerShell instance with administrative rights
    const ps = new PowerShell({
      executionPolicy: 'Bypass',
      noProfile: true
    });

    // Use safer argument handling with proper quotes and escaping
    // The -silent and -cleannvidia flags tell DDU to remove NVIDIA drivers without prompting
    ps.addCommand(`
      try {
        Write-Output "Starting DDU in silent mode to remove NVIDIA drivers..."
        $dduProcess = Start-Process -FilePath "${dduPath.replace(/\\/g, '\\\\')}" -ArgumentList "-silent", "-cleannvidia" -Wait -PassThru
        
        if ($dduProcess.ExitCode -ne 0) {
          Write-Output "DDU exited with code: $($dduProcess.ExitCode)"
          throw "DDU process exited with non-zero code: $($dduProcess.ExitCode)"
        }
        
        Write-Output "DDU completed successfully"
      } catch {
        Write-Error "Error executing DDU: $_"
        exit 1
      }
    `);
    
    ps.invoke()
      .then(output => {
        console.log('DDU execution output:', output);
        ps.dispose();
        
        // Check for error indicators in the output
        if (output && (output.includes('Error executing DDU') || output.includes('exited with non-zero code'))) {
          return reject(new Error(`DDU execution failed: ${output}`));
        }
        
        resolve({ success: true, message: 'NVIDIA drivers successfully uninstalled' });
      })
      .catch(err => {
        console.error('DDU execution error:', err);
        ps.dispose();
        reject(new Error(`Failed to uninstall NVIDIA drivers: ${err.message}`));
      });
  });
}

// Function to run NVCleanInstall
async function runNVCleanInstall(nvciPath, configPath) {
  return new Promise((resolve, reject) => {
    // Validate the path exists before attempting to run
    if (!fs.existsSync(nvciPath)) {
      return reject(new Error(`NVCleanInstall executable not found at path: ${nvciPath}`));
    }

    // If configPath is provided, validate it exists
    if (configPath && !fs.existsSync(configPath)) {
      return reject(new Error(`NVCleanInstall configuration file not found at path: ${configPath}`));
    }

    console.log(`Starting NVCleanInstall from path: ${nvciPath}`);
    if (configPath) {
      console.log(`Using configuration file: ${configPath}`);
    } else {
      console.log('No configuration file provided, will use previous settings');
    }
    
    // Create a new PowerShell instance
    const ps = new PowerShell({
      executionPolicy: 'Bypass',
      noProfile: true
    });

    // Escape the path properly
    let nvciPathEscaped = nvciPath.replace(/\\/g, '\\\\');
    let configArgs = '';
    
    // Add config file to arguments if provided
    if (configPath) {
      const configPathEscaped = configPath.replace(/\\/g, '\\\\');
      configArgs = `-cfg "${configPathEscaped}"`;
    }
    
    // Build the PowerShell command
    ps.addCommand(`
      try {
        Write-Output "Starting NVCleanInstall..."
        
        # Start the NVCleanInstall process with arguments if needed
        $startArgs = @{
          FilePath = "${nvciPathEscaped}"
          PassThru = $true
        }
        
        if ("${configArgs}" -ne "") {
          $startArgs.ArgumentList = "${configArgs}"
          Write-Output "Using configuration file: ${configArgs}"
        } else {
          Write-Output "No configuration provided - will attempt to use 'Use Previous Settings' button"
        }
        
        $process = Start-Process @startArgs
        
        # Wait for the app to initialize properly
        Write-Output "Waiting for NVCleanstall to initialize..."
        Start-Sleep -Seconds 3
        
        # Import UI automation assembly
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        
        # If no config file provided, attempt to click "Use Previous Settings" button
        if ("${configArgs}" -eq "") {
          $maxAttempts = 10
          $attempt = 0
          $success = $false
          
          Write-Output "Searching for NVCleanstall window..."
          
          # Try to find the NVCleanstall window
          while (-not $success -and $attempt -lt $maxAttempts) {
            $attempt++
            
            try {
              # Look for window with NVCleanstall in the title
              $nvcProcess = Get-Process | Where-Object { $_.MainWindowTitle -like "*NVCleanstall*" } | Select-Object -First 1
              
              if ($nvcProcess) {
                Write-Output "Found NVCleanstall window on attempt $attempt"
                $success = $true
              } else {
                Write-Output "Waiting for NVCleanstall window (attempt $attempt of $maxAttempts)..."
                Start-Sleep -Seconds 2
              }
            } catch {
              Write-Output "Error finding window on attempt $attempt: $_"
              Start-Sleep -Seconds 2
            }
          }
          
          if (-not $success) {
            throw "Failed to find NVCleanstall window after $maxAttempts attempts"
          }
          
          # Define the Win32 API function for setting foreground window
          Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
              [DllImport("user32.dll")]
              [return: MarshalAs(UnmanagedType.Bool)]
              public static extern bool SetForegroundWindow(IntPtr hWnd);
              
              [DllImport("user32.dll")]
              public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
              
              // Constants for ShowWindow
              public const int SW_RESTORE = 9;
            }
"@
          
          # Get the window and try to focus it
          $mainWindow = Get-Process | Where-Object { $_.MainWindowTitle -like "*NVCleanstall*" } | Select-Object -First 1
          if ($mainWindow) {
            try {
              # Ensure window is not minimized
              [Win32]::ShowWindow($mainWindow.MainWindowHandle, [Win32]::SW_RESTORE)
              
              # Set the window as foreground
              [Win32]::SetForegroundWindow($mainWindow.MainWindowHandle)
              Write-Output "Successfully focused the NVCleanstall window"
              Start-Sleep -Seconds 1
            } catch {
              Write-Output "Error setting window focus: $_"
            }
            
            # Now try two approaches to click the "Use Previous Settings" button
            Write-Output "Attempting to find and click 'Use Previous Settings' button..."
            
            # First approach - try using UIAutomation to find the button directly
            try {
              Write-Output "Attempting to use UIAutomation to find the button..."
              
              # Get automation element for the window
              $automationElement = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow.MainWindowHandle)
              
              # Look for the "Use Previous Settings" button by name
              $condition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, 
                "Use Previous Settings"
              )
              
              $buttonElement = $automationElement.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants, 
                $condition
              )
              
              # If button found, invoke it
              if ($buttonElement -ne $null) {
                Write-Output "Found 'Use Previous Settings' button via UIAutomation"
                $invokePattern = $buttonElement.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                if ($invokePattern -ne $null) {
                  $invokePattern.Invoke()
                  Write-Output "Successfully clicked 'Use Previous Settings' button via UIAutomation"
                  $success = $true
                  Start-Sleep -Seconds 3
                }
              } else {
                Write-Output "Button not found via UIAutomation, will try keyboard navigation"
              }
            } catch {
              Write-Output "Error using UIAutomation: $_"
            }
            
            # Second approach - keyboard navigation as fallback
            if (-not $success) {
              Write-Output "Trying keyboard navigation as fallback..."
              
              # Reset keyboard state - press Escape to ensure we're at the main dialog
              [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
              Start-Sleep -Milliseconds 500
              
              # Various tab sequences to try - NVCleanstall UI might change between versions
              $tabSequences = @(
                @{ Count = 8; Description = "Standard tab sequence" },
                @{ Count = 6; Description = "Alternate tab sequence 1" },
                @{ Count = 10; Description = "Alternate tab sequence 2" }
              )
              
              foreach ($sequence in $tabSequences) {
                Write-Output "Trying $($sequence.Description) with $($sequence.Count) tabs"
                
                # Press Alt+Tab to refocus the window
                [System.Windows.Forms.SendKeys]::SendWait("%{TAB}")
                Start-Sleep -Milliseconds 500
                
                # Execute tab sequence
                for ($i = 0; $i -lt $sequence.Count; $i++) {
                  [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
                  Start-Sleep -Milliseconds 250
                }
                
                # Press Enter to activate
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Output "Sent ENTER after tab sequence"
                
                # Wait to see if we moved to the next screen
                Start-Sleep -Seconds 3
                
                # Check if we're on a different screen now (simple check - we assume it worked)
                $newWindow = Get-Process | Where-Object { $_.MainWindowTitle -like "*NVCleanstall*" } | Select-Object -First 1
                if ($newWindow -and $newWindow.MainWindowTitle -ne $mainWindow.MainWindowTitle) {
                  Write-Output "Window title changed, assuming we successfully clicked the button"
                  $success = $true
                  break
                }
              }
              
              # If none of the tab sequences worked, try clicking directly at specific screen coordinates
              # This is a last resort method
              if (-not $success) {
                Write-Output "Tab navigation unsuccessful, trying to click at estimated button position..."
                
                # Add mouse click simulation code
                Add-Type @"
                  using System;
                  using System.Runtime.InteropServices;
                  public class MouseOperations {
                    [DllImport("user32.dll")]
                    public static extern bool SetCursorPos(int x, int y);
                    
                    [DllImport("user32.dll")]
                    public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
                    
                    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
                    public const int MOUSEEVENTF_LEFTUP = 0x04;
                    
                    public static void ClickAtPoint(int x, int y) {
                      SetCursorPos(x, y);
                      mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                      mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
                    }
                  }
"@
                
                # Get window position and size
                Add-Type @"
                  using System;
                  using System.Runtime.InteropServices;
                  using System.Drawing;
                  
                  public class WindowInfo {
                    [DllImport("user32.dll")]
                    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                    
                    [StructLayout(LayoutKind.Sequential)]
                    public struct RECT {
                      public int Left;
                      public int Top;
                      public int Right;
                      public int Bottom;
                    }
                  }
"@
                
                # Get window rectangle
                $rect = New-Object WindowInfo+RECT
                [WindowInfo]::GetWindowRect($mainWindow.MainWindowHandle, [ref]$rect)
                
                # Calculate window center position
                $windowWidth = $rect.Right - $rect.Left
                $windowHeight = $rect.Bottom - $rect.Top
                
                # Estimate position of "Use Previous Settings" button
                # This is usually in the bottom right of the first screen
                $buttonX = $rect.Left + ($windowWidth * 0.8)  # 80% across from left
                $buttonY = $rect.Top + ($windowHeight * 0.8)  # 80% down from top
                
                # Click at the estimated position
                Write-Output "Clicking at estimated button position: $buttonX, $buttonY"
                [MouseOperations]::ClickAtPoint([int]$buttonX, [int]$buttonY)
                
                # Wait to see if click was successful
                Start-Sleep -Seconds 3
              }
            }
            
            # Check if we need to handle the next screen (driver selection)
            Write-Output "Checking if we reached the driver selection screen..."
            
            # If we get to the driver selection screen, we can proceed with installation
            # by pressing "NEXT" (which is typically focused by default)
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Write-Output "Sent ENTER key to proceed with installation"
            
            # Wait for a moment to let the installation start
            Start-Sleep -Seconds 2
          } else {
            Write-Output "Warning: Couldn't find the main window to focus"
          }
        }
        
        # Wait for the installation to complete
        Write-Output "Waiting for the installation to complete..."
        $process.WaitForExit()
        
        $exitCode = $process.ExitCode
        Write-Output "NVCleanInstall exited with code: $exitCode"
        
        if ($exitCode -ne 0) {
          throw "NVCleanInstall process exited with non-zero code: $exitCode"
        }
        
        Write-Output "NVCleanInstall completed successfully"
      } catch {
        Write-Error "Error executing NVCleanInstall: $_"
        exit 1
      }
    `);
    
    ps.invoke()
      .then(output => {
        console.log('NVCleanInstall execution output:', output);
        ps.dispose();
        
        // Check for error indicators in the output
        if (output && (output.includes('Error executing NVCleanInstall') || output.includes('exited with non-zero code'))) {
          return reject(new Error(`NVCleanInstall execution failed: ${output}`));
        }
        
        resolve({ success: true, message: 'NVIDIA drivers successfully installed' });
      })
      .catch(err => {
        console.error('NVCleanInstall execution error:', err);
        ps.dispose();
        reject(new Error(`Failed to install NVIDIA drivers: ${err.message}`));
      });
  });
}

// Function to clear NVIDIA shader cache
async function clearNvidiaShaderCache() {
  return new Promise((resolve, reject) => {
    // PowerShell script to clear shader cache
    const script = `
      # Comprehensive list of NVIDIA shader cache locations
      $cacheLocations = @(
        # Standard shader cache locations
        "$env:LOCALAPPDATA\\NVIDIA\\DXCache",
        "$env:LOCALAPPDATA\\NVIDIA\\GLCache",
        "$env:PROGRAMDATA\\NVIDIA Corporation\\NV_Cache",
        
        # Additional locations from documentation and user reports
        "$env:LOCALAPPDATA\\NVIDIA\\ComputeCache",
        "$env:LOCALAPPDATA\\NVIDIA\\OptixCache",
        "$env:LOCALAPPDATA\\NVIDIA\\NV_Cache",
        "$env:APPDATA\\NVIDIA\\ComputeCache",
        "$env:APPDATA\\NVIDIA\\GLCache",
        "$env:TEMP\\NVIDIA Corporation\\NV_Cache",
        
        # Game-specific shader caches
        "$env:LOCALAPPDATA\\NVIDIA\\DXCache",
        "$env:APPDATA\\NVIDIA\\DXCache",
        
        # NVIDIA RTX shader cache paths
        "$env:PROGRAMDATA\\NVIDIA Corporation\\RTXCache",
        "$env:LOCALAPPDATA\\NVIDIA\\RTXCache",
        "$env:APPDATA\\NVIDIA\\RTXCache"
      )
      
      Write-Output "Starting NVIDIA shader cache cleanup..."
      
      # Try to stop processes that might lock shader cache files
      Write-Output "Checking for NVIDIA processes that might lock shader cache files..."
      $nvidiaProcesses = @(
        "nvcontainer",
        "nvcplui",
        "nvtelemetry",
        "nvidia-smi",
        "nvdisplay.container",
        "nvwmi64"
      )
      
      foreach ($process in $nvidiaProcesses) {
        $running = Get-Process -Name $process -ErrorAction SilentlyContinue
        if ($running) {
          Write-Output "Found running NVIDIA process: $process - Attempting to stop it..."
          try {
            Stop-Process -Name $process -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped $process"
            Start-Sleep -Seconds 1
          } catch {
            Write-Output "Could not stop $process - May need administrator privileges"
          }
        }
      }
      
      # Now try to clear the cache files
      $deletedFiles = 0
      $skippedFiles = 0
      $totalFiles = 0
      $failedLocations = @()
      $partiallyCleared = $false
      $directoryCount = 0
      
      foreach ($location in $cacheLocations) {
        Write-Output "Checking location: $location"
        if (Test-Path $location) {
          $directoryCount++
          try {
            $files = Get-ChildItem -Path $location -Recurse -File -ErrorAction Stop
            if ($files) {
              $fileCount = $files.Count
              $totalFiles += $fileCount
              Write-Output "Found $fileCount files in $location"
              
              # Try to clear directory using wildcard first (faster)
              try {
                Remove-Item -Path "$location\\*" -Recurse -Force -ErrorAction Stop
                Write-Output "Bulk deletion successful for $location"
                $deletedFiles += $fileCount
              } catch {
                Write-Output "Bulk deletion failed for $location, trying file-by-file..."
                
                # If bulk deletion fails, try file by file
                foreach ($file in $files) {
                  try {
                    Remove-Item -Path $file.FullName -Force -ErrorAction Stop
                    $deletedFiles++
                  } catch {
                    $skippedFiles++
                    $partiallyCleared = $true
                    Write-Output "Could not delete file: $($file.FullName) - In use or access denied"
                  }
                }
                
                if ($skippedFiles -gt 0) {
                  Write-Output "Partially cleared cache in: $location ($skippedFiles files skipped)"
                } else {
                  Write-Output "Fully cleared cache in: $location"
                }
              }
            } else {
              Write-Output "No files found in $location"
            }
          } catch {
            $failedLocations += $location
            Write-Output "Failed to access cache in: $location - $_"
          }
        } else {
          Write-Output "Location does not exist: $location"
        }
      }
      
      Write-Output "=== Summary ==="
      Write-Output "Shader cache directories found: $directoryCount"
      Write-Output "Total files found: $totalFiles"
      Write-Output "Files successfully deleted: $deletedFiles"
      Write-Output "Files skipped (in use): $skippedFiles"
      
      if ($deletedFiles -eq 0 -and $totalFiles -gt 0) {
        Write-Error "Could not delete any shader cache files. Try running as administrator or rebooting your system first."
        exit 1
      } elseif ($skippedFiles -gt 0) {
        Write-Output "Some shader cache files were in use and could not be deleted."
        Write-Output "For best results, try closing all graphics applications, games, and other NVIDIA services."
        if ($failedLocations.Count -gt 0) {
          Write-Output "Failed locations: $($failedLocations -join ', ')"
        }
        if ($deletedFiles -gt 0) {
          Write-Output "Partial success: $deletedFiles files deleted, $skippedFiles files skipped."
          exit 0
        } else {
          Write-Error "Could not delete any files. Try running as administrator or rebooting your system."
          exit 1
        }
      } elseif ($totalFiles -eq 0) {
        Write-Output "No shader cache files found to delete."
        exit 0
      } else {
        Write-Output "All shader cache files successfully deleted."
        exit 0
      }
    `;

    // Write PowerShell script to a temporary file
    const tempScriptPath = path.join(os.tmpdir(), 'clear-shader-cache.ps1');
    
    fs.writeFileSync(tempScriptPath, script);
    
    // Execute PowerShell script
    const psCommand = `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "${tempScriptPath}"`;
    
    console.log('Executing shader cache clearing command...');
    
    exec(psCommand, (error, stdout, stderr) => {
      // Clean up temp file
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (err) {
        console.error('Failed to delete temp script file:', err);
      }
      
      console.log('PowerShell output:', stdout);
      
      // Check if any files were deleted
      if ((stdout.includes("Files successfully deleted: 0") || 
           stdout.includes("Partial success: 0 files deleted")) && 
          !stdout.includes("No shader cache files found to delete.")) {
        console.error('Failed to delete any shader cache files');
        reject(new Error(
          'Could not delete any shader cache files. Try closing all NVIDIA applications, ' +
          'running the application as administrator, or rebooting your system before trying again.'
        ));
        return;
      }
      
      // Check for partial success
      if (stdout.includes("Partial success:") || 
          (stdout.includes("Files skipped (in use)") && 
           stdout.includes("Files successfully deleted:") && 
           !stdout.includes("Files successfully deleted: 0"))) {
        resolve({
          success: true,
          message: 'NVIDIA shader cache partially cleared. Some files were in use and could not be deleted. ' +
                  'For best results, close all games and NVIDIA applications or reboot your system before trying again.'
        });
        return;
      }
      
      // Check if no files were found
      if (stdout.includes("No shader cache files found to delete.")) {
        resolve({
          success: true,
          message: 'No NVIDIA shader cache files found to delete. Your cache may already be empty.'
        });
        return;
      }
      
      // Full success
      resolve({
        success: true,
        message: 'NVIDIA shader cache successfully cleared. This may improve performance or fix graphical issues.'
      });
    });
  });
}

// Function for integrated shader cache clearing that returns output as it happens
async function clearShaderCacheIntegrated(event) {
  return new Promise((resolve, reject) => {
    const logEntries = [];
    let deletedCount = 0;
    let skippedCount = 0;
    let totalFound = 0;
    let dirCount = 0;
    
    // Add a log entry helper function with priority support
    function addLog(message, priority = false) {
      logEntries.push(message);
      if (event) {
        // Send logs synchronously to ensure they appear in order
        event.sender.send('shader-cache-log', message);
        
        // If this is a priority message, add a small delay to ensure it gets displayed
        if (priority) {
          return new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      return Promise.resolve();
    }
    
    // Function to log detailed information about a path
    async function logDetailedPathInfo(pathToCheck) {
      try {
        if (fs.existsSync(pathToCheck)) {
          const stats = fs.statSync(pathToCheck);
          await addLog(`Path details for ${pathToCheck}:`);
          await addLog(`  - Type: ${stats.isDirectory() ? 'Directory' : 'File'}`);
          await addLog(`  - Size: ${stats.size} bytes`);
          await addLog(`  - Created: ${stats.birthtime}`);
          await addLog(`  - Last modified: ${stats.mtime}`);
          
          if (stats.isDirectory()) {
            try {
              const items = fs.readdirSync(pathToCheck);
              await addLog(`  - Contents: ${items.length} items`);
              if (items.length > 0 && items.length <= 5) {
                await addLog(`  - Items: ${items.join(', ')}`);
              } else if (items.length > 5) {
                await addLog(`  - First 5 items: ${items.slice(0, 5).join(', ')}...`);
              }
            } catch (e) {
              await addLog(`  - Unable to read directory contents: ${e.message}`);
            }
          }
        } else {
          await addLog(`Path does not exist: ${pathToCheck}`);
        }
      } catch (e) {
        await addLog(`Error getting detailed info for ${pathToCheck}: ${e.message}`);
      }
    }
    
    // Define cache locations
    const cacheLocations = [
      `${process.env.LOCALAPPDATA}\\NVIDIA\\DXCache`,
      `${process.env.LOCALAPPDATA}\\NVIDIA\\GLCache`,
      `${process.env.PROGRAMDATA}\\NVIDIA Corporation\\NV_Cache`,
      `${process.env.LOCALAPPDATA}\\NVIDIA\\ComputeCache`,
      `${process.env.LOCALAPPDATA}\\NVIDIA\\OptixCache`,
      `${process.env.LOCALAPPDATA}\\NVIDIA\\NV_Cache`,
      `${process.env.APPDATA}\\NVIDIA\\ComputeCache`,
      `${process.env.APPDATA}\\NVIDIA\\GLCache`,
      `${process.env.TEMP}\\NVIDIA Corporation\\NV_Cache`,
      `${process.env.APPDATA}\\NVIDIA\\DXCache`,
      `${process.env.PROGRAMDATA}\\NVIDIA Corporation\\RTXCache`,
      `${process.env.LOCALAPPDATA}\\NVIDIA\\RTXCache`,
      `${process.env.APPDATA}\\NVIDIA\\RTXCache`
    ];
    
    // Main function to start the process
    async function startCleanup() {
      // First, try to stop NVIDIA processes
      await addLog('Starting NVIDIA shader cache cleanup process...', true);
      await addLog(`System information: ${os.platform()} ${os.release()}`);
      await addLog(`Operating system: ${os.type()} ${os.arch()}`);
      await addLog(`Free memory: ${Math.round(os.freemem() / (1024 * 1024))} MB / ${Math.round(os.totalmem() / (1024 * 1024))} MB`);
      await addLog(`User temp directory: ${os.tmpdir()}`);
      await addLog(`Timestamp: ${new Date().toISOString()}`);
      await addLog('----------------------------------------------', true);
      await addLog(`Will check ${cacheLocations.length} potential cache locations:`);
      
      // List all locations we'll check
      for (let i = 0; i < cacheLocations.length; i++) {
        await addLog(`  ${i+1}. ${cacheLocations[i]}`);
      }
      
      await addLog('----------------------------------------------', true);
      await addLog('Attempting to stop NVIDIA processes that might lock shader cache files...', true);
      
      try {
        const ps = new PowerShell({
          executionPolicy: 'Bypass',
          noProfile: true
        });
        
        ps.addCommand(`
          $processes = Get-Process | Where-Object {$_.Name -like "nv*"}
          if ($processes) {
            Write-Output "Found NVIDIA processes running:"
            $processes | ForEach-Object {
              Write-Output "NVIDIA process: $($_.Name) (PID: $($_.Id))"
              try {
                Write-Output "Stopping process: $($_.Name) (PID: $($_.Id))"
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
                Write-Output "Successfully stopped process: $($_.Name)"
              } catch {
                Write-Output "Error: Could not stop process: $($_.Name) - $($_.Exception.Message)"
              }
            }
          } else {
            Write-Output "No NVIDIA processes found running"
          }
        `);
        
        try {
          const output = await ps.invoke();
          if (output) {
            const lines = output.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                await addLog(line.trim());
              }
            }
          } else {
            await addLog('No output from process stopping operation');
          }
        } catch (err) {
          await addLog(`Error stopping NVIDIA processes: ${err.message}`);
          await addLog('Continuing with shader cache cleanup despite process stopping error...');
        } finally {
          ps.dispose();
        }
      } catch (err) {
        await addLog(`Error setting up process stopping: ${err.message}`);
        await addLog('Continuing with shader cache cleanup despite setup error...');
      }
      
      await addLog('----------------------------------------------', true);
      await addLog('Starting shader cache directory scan and cleanup...', true);
      await cleanCacheLocations();
    }
    
    async function cleanCacheLocations() {
      await addLog(`Starting to check ${cacheLocations.length} cache locations one by one...`, true);
      // Process each cache location
      await processNextLocation(0);
      
      // Show summary and resolve
      await addLog('----------------------------------------------', true);
      await addLog('===== CLEANUP SUMMARY =====', true);
      await addLog(`Cache locations checked: ${cacheLocations.length}`);
      await addLog(`Shader cache directories found: ${dirCount}`);
      await addLog(`Total files found: ${totalFound}`);
      await addLog(`Files successfully deleted: ${deletedCount}`);
      await addLog(`Files skipped (in use): ${skippedCount}`);
      await addLog(`Cleanup efficiency: ${totalFound > 0 ? Math.round((deletedCount / totalFound) * 100) : 100}%`);
      await addLog(`Completed at: ${new Date().toISOString()}`);
      
      let resultMessage = '';
      if (deletedCount === 0 && totalFound > 0) {
        resultMessage = 'Could not delete any shader cache files. Try closing all NVIDIA applications or reboot your system.';
      } else if (skippedCount > 0) {
        resultMessage = `NVIDIA shader cache partially cleared. ${deletedCount} files deleted, ${skippedCount} files skipped.`;
      } else if (totalFound === 0) {
        resultMessage = 'No NVIDIA shader cache files found to delete.';
      } else {
        resultMessage = `All ${deletedCount} shader cache files successfully deleted.`;
      }
      
      await addLog(`Result: ${resultMessage}`, true);
      await addLog('===== END OF REPORT =====', true);
      
      // Resolve with results
      resolve({
        success: deletedCount > 0 || totalFound === 0,
        message: resultMessage,
        log: logEntries,
        stats: {
          dirCount,
          totalFound,
          deletedCount,
          skippedCount
        }
      });
    }
    
    async function processNextLocation(index) {
      if (index >= cacheLocations.length) {
        return; // All locations processed
      }
      
      const location = cacheLocations[index];
      await addLog(`[${index + 1}/${cacheLocations.length}] Checking location: ${location}`, true);
      
      // Check if location exists
      try {
        if (!fs.existsSync(location)) {
          await addLog(`Location does not exist: ${location}`);
          await addLog(`Skipping to next location...`);
          return await processNextLocation(index + 1);
        }
        
        // Location exists, increment directory count
        dirCount++;
        await addLog(`Found existing shader cache directory: ${location}`, true);
        
        // Get detailed info for this directory
        await logDetailedPathInfo(location);
        
        // Get all files in the location
        await addLog(`Scanning for cache files in: ${location}`, true);
        const files = await getAllFiles(location);
        
        if (!files || files.length === 0) {
          await addLog(`No files found in ${location} - Directory is empty`);
          await addLog(`Skipping to next location...`);
          return await processNextLocation(index + 1);
        }
        
        totalFound += files.length;
        await addLog(`Found ${files.length} cache files in ${location}`, true);
        
        // List some example files for detailed logging
        if (files.length > 0) {
          if (files.length <= 10) {
            await addLog(`All files: ${files.map(f => path.basename(f)).join(', ')}`);
          } else {
            await addLog(`First 10 files: ${files.slice(0, 10).map(f => path.basename(f)).join(', ')}...`);
          }
        }
        
        // Try bulk deletion first
        try {
          await addLog(`Attempting bulk deletion for ${location}...`, true);
          fs.rmSync(`${location}\\*`, { recursive: true, force: true });
          await addLog(`Bulk deletion successful for ${location}`, true);
          deletedCount += files.length;
          await addLog(`Successfully deleted ${files.length} files from ${location}`);
          
          // Verify the deletion worked
          try {
            const remainingFiles = fs.readdirSync(location);
            if (remainingFiles.length > 0) {
              await addLog(`Warning: Some files might still remain in the directory. Found ${remainingFiles.length} items.`);
            } else {
              await addLog(`Verified: Directory is now empty.`);
            }
          } catch (err) {
            await addLog(`Could not verify directory contents after deletion: ${err.message}`);
          }
          
          await addLog(`Moving to next location...`);
          return await processNextLocation(index + 1);
        } catch (err) {
          // Bulk deletion failed, try file by file
          await addLog(`Warning: Bulk deletion failed with error: ${err.message}`, true);
          await addLog(`Attempting file-by-file deletion for ${location}...`, true);
          
          await deleteFilesOneByOne(files, location);
          await addLog(`Moving to next location...`);
          return await processNextLocation(index + 1);
        }
      } catch (err) {
        await addLog(`Error processing ${location}: ${err.message}`, true);
        await addLog(`Skipping to next location...`);
        return await processNextLocation(index + 1);
      }
    }
    
    async function deleteFilesOneByOne(files, location) {
      let successCount = 0;
      let errorCount = 0;
      
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        try {
          fs.unlinkSync(file);
          deletedCount++;
          successCount++;
          // Log every file for small caches, or periodic updates for large ones
          if (fileIndex % 5 === 0 || fileIndex === files.length - 1 || files.length < 20) {
            await addLog(`Deleted file (${fileIndex + 1}/${files.length}): ${path.basename(file)}`);
          }
        } catch (err) {
          skippedCount++;
          errorCount++;
          // Log every error for small caches, or just a sampling for large ones
          if (errorCount <= 5 || errorCount % 20 === 0 || files.length < 20) {
            await addLog(`Warning: Could not delete file: ${path.basename(file)} - ${err.message}`);
          }
        }
        
        // Periodic progress updates
        if (fileIndex % 20 === 0 && fileIndex > 0 && files.length >= 50) {
          await addLog(`Progress: ${Math.round((fileIndex/files.length)*100)}% (${fileIndex}/${files.length})`);
        }
      }
      
      await addLog(`File-by-file deletion completed for ${location}`, true);
      await addLog(`${successCount} files deleted, ${errorCount} files skipped`);
    }
    
    async function getAllFiles(dir) {
      if (!fs.existsSync(dir)) return [];
      
      let results = [];
      try {
        await addLog(`Reading directory: ${dir}`);
        const list = fs.readdirSync(dir);
        await addLog(`Found ${list.length} items in directory ${dir}`);
        
        for (const file of list) {
          const fullPath = path.join(dir, file);
          
          try {
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              // Recurse into subdirectory
              await addLog(`Found subdirectory: ${fullPath}`);
              const subDirFiles = await getAllFiles(fullPath);
              await addLog(`Found ${subDirFiles.length} files in subdirectory: ${fullPath}`);
              results = results.concat(subDirFiles);
            } else {
              // Add file to results
              results.push(fullPath);
            }
          } catch (err) {
            // Skip this file if there's an error getting stat
            await addLog(`Warning: Error accessing ${fullPath}: ${err.message}`);
            continue;
          }
        }
      } catch (err) {
        // Return empty array if directory can't be read
        await addLog(`Error reading directory ${dir}: ${err.message}`);
        return [];
      }
      
      return results;
    }
    
    // Start the cleanup process
    startCleanup();
  });
} // End of clearShaderCacheIntegrated function 