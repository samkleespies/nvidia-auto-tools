const { ipcRenderer } = require('electron');
const { dialog } = require('@electron/remote');
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Screens
const homeScreen = document.getElementById('home-screen');
const driverToolsScreen = document.getElementById('driver-tools-screen');
const shaderCacheScreen = document.getElementById('shader-cache-screen');

// Home screen buttons
const btnShaderCache = document.getElementById('btn-shader-cache');
const btnDriverTools = document.getElementById('btn-driver-tools');

// Navigation buttons
const returnToHome = document.getElementById('return-to-home');
const returnFromCache = document.getElementById('return-from-cache');

// DOM elements from driver tools screen
const dduPathInput = document.getElementById('ddu-path');
const nvciPathInput = document.getElementById('nvci-path');
const driverVersionSelector = document.getElementById('driver-version-selector');
const browseDduBtn = document.getElementById('browse-ddu');
const browseNvciBtn = document.getElementById('browse-nvci');
const refreshDriversBtn = document.getElementById('refresh-drivers');
const downloadDriverBtn = document.getElementById('download-driver');
const startProcessBtn = document.getElementById('start-process');
const statusElement = document.getElementById('status');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const logElement = document.getElementById('log');

// Workflow step elements
const step1Element = document.getElementById('step1');
const step2Element = document.getElementById('step2');
const step3Element = document.getElementById('step3');
const step1Status = step1Element.querySelector('.current-status');
const step2Status = step2Element.querySelector('.current-status');
const step3Status = step3Element.querySelector('.current-status');

// DOM elements from shader cache screen
const startCacheCleanupBtn = document.getElementById('start-cache-cleanup');
const cacheStatusElement = document.getElementById('cache-status');
const cacheProgressContainer = document.getElementById('cache-progress-container');
const cacheProgressBar = document.getElementById('cache-progress-bar');
const cacheProgressText = document.getElementById('cache-progress-text');

// Set default paths (adjust if necessary for typical installations)
dduPathInput.value = 'C:\\Program Files\\Display Driver Uninstaller\\Display Driver Uninstaller.exe';
nvciPathInput.value = 'C:\\Program Files\\NVCleanstall\\NVCleanstall.exe';
const cacheLogElement = document.getElementById('cache-log');
const clearCacheLogBtn = document.getElementById('clear-cache-log');
const saveCacheLogBtn = document.getElementById('save-cache-log');

// Driver installation state
let driverInstallState = {
  selectedDriverVersion: null,
  driverDownloaded: false,
  driverDownloadPath: null,
  customDriverPath: null,
  nvciProcessId: null,
  dduProcessId: null,
  installProcessId: null,
  currentStep: 0
};

// Navigation functions
function showScreen(screen) {
  // Hide all screens
  homeScreen.classList.add('hidden');
  driverToolsScreen.classList.add('hidden');
  shaderCacheScreen.classList.add('hidden');
  
  // Show the requested screen
  screen.classList.remove('hidden');
  screen.classList.add('fadeIn');
}

// Set up navigation button event listeners
btnShaderCache.addEventListener('click', () => showScreen(shaderCacheScreen));
btnDriverTools.addEventListener('click', () => {
  showScreen(driverToolsScreen);
  fetchNvidiaDriverVersions(); // Fetch driver versions when screen is shown
});
returnToHome.addEventListener('click', () => showScreen(homeScreen));
returnFromCache.addEventListener('click', () => showScreen(homeScreen));

// Function to add log message for driver tools
function addLog(message, type = 'info') {
  const logEntry = document.createElement('div');
  logEntry.classList.add('log-entry', `log-${type}`);
  
  const timestamp = new Date().toLocaleTimeString();
  logEntry.textContent = `[${timestamp}] ${message}`;
  
  logElement.appendChild(logEntry);
  logElement.scrollTop = logElement.scrollHeight;
}

// Function to add cache log message directly as text (for monospace formatting)
function addCacheLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const timestampSpan = document.createElement('span');
  timestampSpan.classList.add('log-timestamp');
  timestampSpan.textContent = `[${timestamp}]`;
  
  const messageSpan = document.createElement('span');
  
  // Determine if this is a detail line (indented information)
  if (message.startsWith('  -') || message.startsWith('    ')) {
    messageSpan.classList.add('log-detail');
    type = 'detail';
  } else if (message.startsWith('===') || message.includes('SUMMARY') || message.includes('REPORT')) {
    type = 'highlight';
  } else if (message.startsWith('---')) {
    type = 'highlight';
  }
  
  messageSpan.classList.add(`log-${type}`);
  messageSpan.textContent = ` ${message}`;
  
  const logEntry = document.createElement('div');
  logEntry.appendChild(timestampSpan);
  logEntry.appendChild(messageSpan);
  
  cacheLogElement.appendChild(logEntry);
  cacheLogElement.scrollTop = cacheLogElement.scrollHeight;
  
  // Force a repaint to ensure the log entry appears immediately
  cacheLogElement.style.display = 'none';
  cacheLogElement.offsetHeight; // This line forces a repaint
  cacheLogElement.style.display = '';
}

// Function to update status
function updateStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = 'status ' + type;
}

// Function to update cache status
function updateCacheStatus(message, type) {
  cacheStatusElement.textContent = message;
  cacheStatusElement.className = 'status ' + type;
}

// Function to update progress
function updateProgress(percent) {
  // Ensure we have a valid percentage
  percent = Math.max(0, Math.min(100, Math.round(percent)));
  
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  
  // Set classes based on progress
  progressBar.classList.remove('progress-started', 'progress-halfway', 'progress-almostdone');
  
  if (percent > 0 && percent < 30) {
    progressBar.classList.add('progress-started');
  } else if (percent >= 30 && percent < 75) {
    progressBar.classList.add('progress-halfway');
  } else if (percent >= 75 && percent < 100) {
    progressBar.classList.add('progress-almostdone');
  }
  
  // Show/hide the progress container
  if (percent > 0 && percent < 100) {
    progressContainer.classList.remove('hidden');
  } else if (percent >= 100) {
    // When download is complete, keep showing 100% for a moment, then hide
    progressBar.style.width = '100%';
    progressText.textContent = '100%';
    setTimeout(() => {
      progressContainer.classList.add('hidden');
    }, 1500); // Hide after 1.5 seconds
  } else {
    progressContainer.classList.add('hidden');
  }
}

// Function to update cache progress
function updateCacheProgress(percent) {
  cacheProgressBar.style.width = `${percent}%`;
  cacheProgressText.textContent = `${percent}%`;
  
  if (percent > 0 && percent < 100) {
    cacheProgressContainer.classList.remove('hidden');
  } else {
    cacheProgressContainer.classList.add('hidden');
  }
}

// Function to update workflow step status
function updateStepStatus(stepNumber, status, message = null) {
  const stepElement = document.getElementById(`step${stepNumber}`);
  const statusElement = stepElement.querySelector('.current-status');
  
  // Remove all status classes
  statusElement.classList.remove('waiting', 'in-progress', 'monitoring', 'completed', 'error');
  stepElement.classList.remove('active', 'completed', 'error');
  
  // Clear any existing monitoring dots
  while (statusElement.firstChild) {
    statusElement.removeChild(statusElement.firstChild);
  }
  
  // Add the appropriate classes based on status
  statusElement.classList.add(status);
  
  // Set the status message or use default messages
  let statusMessage = '';
  switch (status) {
    case 'waiting':
      statusMessage = message || 'Waiting to start';
      stepElement.classList.remove('active');
      break;
    case 'in-progress':
      statusMessage = message || 'In progress';
      stepElement.classList.add('active');
      break;
    case 'monitoring':
      statusMessage = message || 'Monitoring user activity';
      stepElement.classList.add('active');
      
      // Create monitoring dots
      const textNode = document.createTextNode(statusMessage + ' ');
      statusElement.appendChild(textNode);
      
      // Add animated dots
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.classList.add('monitoring-dot');
        statusElement.appendChild(dot);
      }
      return; // Skip the text assignment below
    case 'completed':
      statusMessage = message || 'Completed';
      stepElement.classList.add('completed');
      break;
    case 'error':
      statusMessage = message || 'Error occurred';
      stepElement.classList.add('error');
      break;
  }
  
  statusElement.textContent = statusMessage;
}

// Function to browse for files
async function browseForFile(title, filters) {
  const result = await dialog.showOpenDialog({
    title: title,
    filters: filters,
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
}

// Set up browse button for DDU
browseDduBtn.addEventListener('click', async () => {
  const path = await browseForFile('Select DDU Executable', [
    { name: 'Executable', extensions: ['exe'] }
  ]);
  
  if (path) {
    dduPathInput.value = path;
    addLog(`DDU path set to: ${path}`);
  }
});

// Set up browse button for NVCleanInstall
browseNvciBtn.addEventListener('click', async () => {
  const path = await browseForFile('Select NVCleanInstall Executable', [
    { name: 'Executable', extensions: ['exe'] }
  ]);
  
  if (path) {
    nvciPathInput.value = path;
    addLog(`NVCleanInstall path set to: ${path}`);
  }
});

// Function to fetch NVIDIA driver versions
async function fetchNvidiaDriverVersions() {
  try {
    // Disable the selector while fetching
    driverVersionSelector.disabled = true;
    refreshDriversBtn.disabled = true;
    downloadDriverBtn.disabled = true;
    
    // Clear the selector and add a loading option
    driverVersionSelector.innerHTML = '<option value="">Loading driver versions...</option>';
    
    addLog('Fetching latest NVIDIA driver versions...', 'info');
    
    // Request the driver versions from the main process
    const driverVersions = await ipcRenderer.invoke('fetch-nvidia-drivers');
    
    if (!driverVersions || driverVersions.length === 0) {
      throw new Error('Failed to fetch driver versions');
    }
    
    // Clear the selector
    driverVersionSelector.innerHTML = '';
    
    // Add a prompt option
    const promptOption = document.createElement('option');
    promptOption.value = '';
    promptOption.textContent = 'Select a driver version';
    driverVersionSelector.appendChild(promptOption);
    
    // Add the driver versions to the selector
    driverVersions.forEach(driver => {
      const option = document.createElement('option');
      option.value = driver.id;
      option.textContent = `${driver.version} - ${driver.releaseDate}`;
      option.dataset.version = driver.version;
      option.dataset.url = driver.url;
      option.dataset.size = driver.size || 'Unknown';
      option.dataset.releaseDate = driver.releaseDate;
      driverVersionSelector.appendChild(option);
    });
    
    addLog(`Fetched ${driverVersions.length} NVIDIA driver versions successfully`, 'success');
    
    // Re-enable the selector
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
    
    // Check for driver in Downloads
    driverVersionSelector.addEventListener('change', checkDriverAvailability);
  } catch (error) {
    addLog(`Error fetching driver versions: ${error.message}`, 'error');
    driverVersionSelector.innerHTML = '<option value="">Error loading drivers - click refresh</option>';
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
  }
}

// Function to check if selected driver is already downloaded
async function checkDriverAvailability() {
  downloadDriverBtn.disabled = true;
  
  const selectedOption = driverVersionSelector.options[driverVersionSelector.selectedIndex];
  
  // If no valid option is selected
  if (!selectedOption || !selectedOption.value) {
    driverInstallState.selectedDriverVersion = null;
    driverInstallState.driverDownloaded = false;
    driverInstallState.driverDownloadPath = null;
    return;
  }
  
  // Get driver info from the selected option
  const driverVersion = selectedOption.dataset.version;
  const driverUrl = selectedOption.dataset.url;
  
  driverInstallState.selectedDriverVersion = driverVersion;
  
  // Check if the driver is already in the Downloads folder
  const downloadsPath = path.join(require('os').homedir(), 'Downloads');
  const expectedFilename = path.basename(new URL(driverUrl).pathname);
  const possibleDriverPaths = [
    path.join(downloadsPath, expectedFilename),
    path.join(downloadsPath, `NVIDIA-${driverVersion}.exe`),
    path.join(downloadsPath, `NVIDIA-GeForce-${driverVersion}.exe`),
    path.join(downloadsPath, `NVIDIA_GeForce_${driverVersion}.exe`),
    // More potential naming patterns can be added here
  ];
  
  let driverFound = false;
  for (const driverPath of possibleDriverPaths) {
    if (fs.existsSync(driverPath)) {
      driverInstallState.driverDownloaded = true;
      driverInstallState.driverDownloadPath = driverPath;
      driverFound = true;
      addLog(`Driver version ${driverVersion} found in Downloads folder: ${driverPath}`, 'success');
      downloadDriverBtn.textContent = 'Driver Already Downloaded';
      downloadDriverBtn.disabled = true;
      break;
    }
  }
  
  if (!driverFound) {
    driverInstallState.driverDownloaded = false;
    driverInstallState.driverDownloadPath = null;
    addLog(`Driver version ${driverVersion} not found in Downloads folder`, 'info');
    downloadDriverBtn.textContent = 'Download Selected Driver';
    downloadDriverBtn.disabled = false;
  }
}

// Set up refresh drivers button
refreshDriversBtn.addEventListener('click', fetchNvidiaDriverVersions);

// Set up download driver button
downloadDriverBtn.addEventListener('click', async () => {
  const selectedOption = driverVersionSelector.options[driverVersionSelector.selectedIndex];
  
  if (!selectedOption || !selectedOption.value) {
    addLog('No driver selected for download', 'error');
    return;
  }
  
  const driverVersion = selectedOption.dataset.version;
  const driverUrl = selectedOption.dataset.url;
  
  try {
    // Disable UI elements during download
    downloadDriverBtn.disabled = true;
    driverVersionSelector.disabled = true;
    refreshDriversBtn.disabled = true;
    downloadDriverBtn.textContent = 'Downloading...';
    addLog(`Starting download of driver version ${driverVersion}...`, 'info');
    
    // Show initial progress at 0%
    updateProgress(0);
    
    // Display file size information if available
    if (selectedOption.dataset.size && selectedOption.dataset.size !== 'Unknown size') {
      addLog(`File size: ${selectedOption.dataset.size}`, 'info');
    }
    
    // Add a timestamp for download start
    const startTime = new Date();
    addLog(`Download started at: ${startTime.toLocaleTimeString()}`, 'info');
    
    // Start the download via the main process
    const result = await ipcRenderer.invoke('download-driver', driverUrl, driverVersion);
    
    if (result.success) {
      driverInstallState.driverDownloaded = true;
      driverInstallState.driverDownloadPath = result.filePath;
      
      // Calculate and show download time
      const endTime = new Date();
      const downloadDuration = Math.round((endTime - startTime) / 1000); // in seconds
      
      // Show completion status with time information
      updateProgress(100); // Ensure progress shows 100%
      addLog(`Driver version ${driverVersion} downloaded successfully to: ${result.filePath}`, 'success');
      addLog(`Download completed in ${downloadDuration} seconds`, 'success');
      downloadDriverBtn.textContent = 'Driver Downloaded';
      
      // Check driver availability after download
      checkDriverAvailability();
    } else {
      updateProgress(0); // Reset progress bar
      throw new Error(result.message || 'Download failed with unknown error');
    }
  } catch (error) {
    updateProgress(0); // Reset progress bar
    addLog(`Error downloading driver: ${error.message}`, 'error');
    downloadDriverBtn.textContent = 'Download Failed - Try Again';
    downloadDriverBtn.disabled = false;
  } finally {
    // Re-enable UI elements after download
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
  }
});

// Handle progress updates during download
ipcRenderer.on('download-progress', (event, progress) => {
  updateProgress(Math.round(progress * 100));
});

// Function to validate inputs for driver tools
function validateInputs() {
  const dduPath = dduPathInput.value.trim();
  const nvciPath = nvciPathInput.value.trim();
  
  if (!dduPath) {
    addLog('DDU path is required', 'error');
    return false;
  }
  
  if (!nvciPath) {
    addLog('NVCleanInstall path is required', 'error');
    return false;
  }
  
  // Check if paths are likely valid executables
  if (!dduPath.toLowerCase().endsWith('.exe')) {
    addLog('DDU path should point to an .exe file', 'warning');
  }
  
  if (!nvciPath.toLowerCase().endsWith('.exe')) {
    addLog('NVCleanInstall path should point to an .exe file', 'warning');
  }
  
  // Check if driver is selected
  if (!driverInstallState.selectedDriverVersion) {
    addLog('Please select a driver version', 'error');
    return false;
  }
  
  // Check if driver is available
  if (!driverInstallState.driverDownloaded || !driverInstallState.driverDownloadPath) {
    addLog('Selected driver must be downloaded first', 'error');
    return false;
  }
  
  return true;
}

// Set up start process button
startProcessBtn.addEventListener('click', async () => {
  if (!validateInputs()) {
    return;
  }

  // Show confirmation dialog
  const confirmation = await dialog.showMessageBox({
    type: 'warning',
    title: 'Confirm Driver Installation',
    message: 'Ready to start the driver installation process?',
    detail: `This process will guide you through creating a custom driver package with NVCleanInstall, then uninstalling your current driver with DDU, and finally automatically installing the new driver.\n\nMake sure all your work is saved before continuing.`,
    buttons: ['Cancel', 'Start Process'],
    defaultId: 1, // Default to 'Start Process'
    cancelId: 0 // 'Cancel' button
  });

  if (confirmation.response !== 1) { // 1 is 'Start Process'
    addLog('Operation canceled by user before starting.', 'info');
    return;
  }

  // --- Check for existing packaged driver ---
  let skipStep1 = false;
  let existingDriverPath = null;
  try {
    addLog('Checking for existing packaged driver in Downloads...', 'info');
    const checkResult = await ipcRenderer.invoke('check-existing-packaged-driver');

    if (checkResult.error) {
       addLog(`Warning: Could not check for existing driver: ${checkResult.error}`, 'warning');
    } else if (checkResult.found) {
      addLog(`Found existing driver: ${checkResult.filename}`, 'info');
      const skipConfirmation = await dialog.showMessageBox({
        type: 'question',
        title: 'Existing Driver Found',
        message: `Found an existing packaged driver:\n${checkResult.filename}\n\nDo you want to use this driver and skip Step 1 (NVCleanstall)?`,
        buttons: ['Cancel', 'Use Existing Driver', 'Run Step 1 Anyway'],
        defaultId: 1, // Default to 'Use Existing Driver'
        cancelId: 0 // 'Cancel' button
      });

      if (skipConfirmation.response === 0) { // Cancel
        addLog('Operation canceled by user after finding existing driver.', 'info');
        return;
      } else if (skipConfirmation.response === 1) { // Use Existing Driver
        skipStep1 = true;
        existingDriverPath = checkResult.path;
        addLog(`User chose to skip Step 1 and use existing driver: ${existingDriverPath}`, 'info');
      } else { // Run Step 1 Anyway (response === 2)
        addLog('User chose to run Step 1 even though an existing driver was found.', 'info');
      }
    } else {
       addLog('No existing packaged driver found in Downloads.', 'info');
    }
  } catch (checkError) {
    addLog(`Error checking for existing driver: ${checkError.message}. Proceeding with Step 1.`, 'warning');
    // Proceed without skipping if check fails
  }
  // --- End check ---


  const dduPath = dduPathInput.value.trim();
  const nvciPath = nvciPathInput.value.trim();

  try {
    // Disable inputs and button (do this AFTER the check and potential cancel)
    dduPathInput.disabled = true;
    nvciPathInput.disabled = true;
    driverVersionSelector.disabled = true;
    refreshDriversBtn.disabled = true;
    downloadDriverBtn.disabled = true;
    startProcessBtn.disabled = true;

    if (skipStep1) {
      // --- Logic for Skipping Step 1 ---
      driverInstallState.customDriverPath = existingDriverPath; // Use the found driver path
      driverInstallState.currentStep = 2; // Start at step 2
      updateStepStatus(1, 'skipped', 'Skipped - Using existing driver');
      updateStepStatus(2, 'in-progress');
      updateStepStatus(3, 'waiting', 'Waiting for previous step');
      updateStatus('Running: Step 2 - Uninstall Current Drivers', 'running');
      addLog('Skipping Step 1 as requested.', 'info');
      // Directly proceed to Step 2 logic below

    } else {
      // --- Original Logic for Step 1 ---
      driverInstallState.currentStep = 1;
      updateStepStatus(1, 'in-progress');
      updateStepStatus(2, 'waiting', 'Waiting for previous step');
      updateStepStatus(3, 'waiting', 'Waiting for previous step');
      updateStatus('Running: Step 1 - Create Custom Driver Package', 'running');
      addLog('Starting Step 1: Create Custom Driver Package...', 'info');

      // Step 1: Run NVCleanInstall to create custom driver
      try {
        addLog('Launching NVCleanInstall to create a custom driver package...', 'info');
        addLog(`NVCleanInstall path: ${nvciPath}`, 'info');
        addLog(`Driver path: ${driverInstallState.driverDownloadPath}`, 'info');

        // Launch NVCleanInstall with the driver file
        const nvciResult = await ipcRenderer.invoke('launch-nvci-prepare', nvciPath, driverInstallState.driverDownloadPath);

        if (!nvciResult.success) {
          throw new Error(nvciResult.message);
        }

        driverInstallState.nvciProcessId = nvciResult.processId;

        // Update step to monitoring status
        updateStepStatus(1, 'monitoring', 'NVCleanInstall is open - please create your custom package');
        addLog('NVCleanInstall is now open. Please create your custom driver package.', 'info');
        addLog('The app will monitor the process and proceed once the package is created.', 'info');

        // Start monitoring for completion
        const customDriverInfo = await ipcRenderer.invoke('monitor-nvci-completion');

        if (customDriverInfo.success) {
          driverInstallState.customDriverPath = customDriverInfo.driverPath; // Path is set here
          updateStepStatus(1, 'completed', 'Custom driver package created');
          addLog(`Custom driver package created successfully at: ${customDriverInfo.driverPath}`, 'success');
        } else {
          throw new Error(customDriverInfo.message || 'Failed to detect custom driver package');
        }

      } catch (nvciError) {
        updateStepStatus(1, 'error', `Failed: ${nvciError.message}`);
        addLog(`Step 1 Error: ${nvciError.message}`, 'error');
        // Re-enable inputs on failure before throwing
        dduPathInput.disabled = false;
        nvciPathInput.disabled = false;
        driverVersionSelector.disabled = false;
        refreshDriversBtn.disabled = false;
        downloadDriverBtn.disabled = false;
        startProcessBtn.disabled = false;
        throw new Error(`Step 1 failed: ${nvciError.message}`); // Propagate error to outer catch
      }
      // --- End Original Logic for Step 1 ---
    }


    // --- Step 2: Run DDU (Common path for both skipped and non-skipped Step 1) ---
    if (driverInstallState.currentStep < 2) driverInstallState.currentStep = 2; // Ensure step is 2 if coming from step 1
    if (!skipStep1) updateStepStatus(2, 'in-progress'); // Update status only if not already set by skip logic
    updateStatus('Running: Step 2 - Uninstall Current Drivers', 'running');

    try {
      addLog('Launching DDU to uninstall current NVIDIA drivers...', 'info');
      addLog(`DDU path: ${dduPath}`, 'info');

      // Launch DDU
      const dduLaunchResult = await ipcRenderer.invoke('launch-ddu', dduPath);
      if (!dduLaunchResult.success) {
        throw new Error(dduLaunchResult.message);
      }

      // Update step to monitoring status
      updateStepStatus(2, 'monitoring', 'DDU is open - please follow its instructions');
      addLog('DDU is now open. Please follow its instructions (usually "Clean and restart").', 'info');
      addLog('The app will monitor for DDU completion and potential reboot.', 'info');

      // Monitor DDU completion
      const dduMonitorResult = await ipcRenderer.invoke('monitor-ddu-completion');

      if (dduMonitorResult.success) {
         updateStepStatus(2, 'completed', 'DDU process completed');
         addLog('DDU process completed.', 'success');
         if (dduMonitorResult.rebootNeeded) {
            addLog('DDU indicated a reboot is needed. Please reboot your computer manually.', 'warning');
            updateStatus('Action Required: Reboot your computer', 'warning');
            // Optionally prompt user to confirm reboot before proceeding? For now, just inform.
            await dialog.showMessageBox({
                type: 'info',
                title: 'Reboot Required',
                message: 'DDU has completed, but a system reboot is required before installing the new driver.',
                detail: 'Please reboot your computer now. After rebooting, re-launch this application to continue with Step 3 (Driver Installation).',
                buttons: ['OK']
            });
            // Stop the process here, user needs to reboot and restart app
            // Re-enable button to allow restart? Maybe not.
            startProcessBtn.disabled = false; // Allow restart? Maybe better to keep disabled.
            return; // Exit the function
         }
      } else {
         throw new Error(dduMonitorResult.message || 'Failed to monitor DDU completion');
      }

    } catch (dduError) {
      updateStepStatus(2, 'error', `Failed: ${dduError.message}`);
      addLog(`Step 2 Error: ${dduError.message}`, 'error');
      // Re-enable inputs on failure before throwing
      dduPathInput.disabled = false;
      nvciPathInput.disabled = false;
      driverVersionSelector.disabled = false;
      refreshDriversBtn.disabled = false;
      downloadDriverBtn.disabled = false;
      startProcessBtn.disabled = false;
      throw new Error(`Step 2 failed: ${dduError.message}`); // Propagate error to outer catch
    }
    // --- End Step 2 ---


    // --- Step 3: Install Custom Driver ---
    // (This part only runs if Step 2 completed successfully WITHOUT needing a reboot)
    driverInstallState.currentStep = 3;
    updateStepStatus(3, 'in-progress');
    updateStatus('Running: Step 3 - Install Custom Driver', 'running');

    try {
       addLog('Starting installation of the custom driver package...', 'info');
       addLog(`Custom driver path: ${driverInstallState.customDriverPath}`, 'info');

       if (!driverInstallState.customDriverPath) {
           throw new Error('Custom driver path is not set. Cannot proceed.');
       }

       // Launch installer
       const installResult = await ipcRenderer.invoke('install-custom-driver', driverInstallState.customDriverPath);
       if (!installResult.success) {
           throw new Error(installResult.message);
       }

       // Update step to monitoring status
       updateStepStatus(3, 'monitoring', 'Driver installer is running...');
       addLog('NVIDIA driver installer is running. Please follow its prompts.', 'info');
       addLog('The app will monitor for completion.', 'info');

       // Monitor installation
       const monitorResult = await ipcRenderer.invoke('monitor-driver-installation');

       if (monitorResult.success) {
           updateStepStatus(3, 'completed', 'Driver installation completed');
           addLog('Custom driver installation completed successfully.', 'success');
           updateStatus('Process Completed Successfully!', 'success');
       } else {
           throw new Error(monitorResult.message || 'Failed to confirm driver installation completion');
       }

    } catch (installError) {
       updateStepStatus(3, 'error', `Failed: ${installError.message}`);
       addLog(`Step 3 Error: ${installError.message}`, 'error');
       // Re-enable inputs on failure before throwing
       dduPathInput.disabled = false;
       nvciPathInput.disabled = false;
       driverVersionSelector.disabled = false;
       refreshDriversBtn.disabled = false;
       downloadDriverBtn.disabled = false;
       startProcessBtn.disabled = false;
       throw new Error(`Step 3 failed: ${installError.message}`); // Propagate error to outer catch
    }
    // --- End Step 3 ---

    // Re-enable inputs on successful completion
    dduPathInput.disabled = false;
    nvciPathInput.disabled = false;
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
    downloadDriverBtn.disabled = false;
    startProcessBtn.disabled = false;

  } catch (error) {
    // Catch errors propagated from Steps 1, 2, or 3
    updateStatus(`Error: ${error.message}`, 'error');
    addLog(`Process failed: ${error.message}`, 'error');
    // Ensure inputs are re-enabled if an error occurred mid-process
    dduPathInput.disabled = false;
    nvciPathInput.disabled = false;
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
    downloadDriverBtn.disabled = false;
    startProcessBtn.disabled = false;
  } finally {
    // Re-enable inputs and button (ensure this happens even if reboot is needed and we return early)
    dduPathInput.disabled = false;
    nvciPathInput.disabled = false;
    driverVersionSelector.disabled = false;
    refreshDriversBtn.disabled = false;
    downloadDriverBtn.disabled = false;
    startProcessBtn.disabled = false; // Ensure button is re-enabled unless process completes fully without error/reboot
  }
});

// Set up integrated shader cache cleanup
startCacheCleanupBtn.addEventListener('click', async () => {
  try {
    // Confirmation dialog
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Clear NVIDIA Shader Cache',
      message: 'This will delete all NVIDIA shader cache files on your system.',
      detail: 'This action can help fix graphical issues but may cause temporary stuttering in games as the shader cache rebuilds. Do you want to continue?',
      buttons: ['Cancel', 'Clear Shader Cache'],
      defaultId: 0,
      cancelId: 0
    });
    
    if (confirmation.response === 1) {
      // User confirmed, proceed with cache clearing
      startCacheCleanupBtn.disabled = true;
      updateCacheStatus('Running: Clearing NVIDIA Shader Cache', 'running');
      updateCacheProgress(25);
      
      // Add a separator for new operation, but don't clear previous logs
      if (cacheLogElement.childElementCount > 0) {
        addCacheLog('--------- New Cache Clearing Operation ---------', 'highlight');
      }
      
      // Detach any previous listeners to avoid duplicates
      ipcRenderer.removeAllListeners('shader-cache-log');
      
      // Create a counter for the logs
      let logCounter = 0;
      
      // Listen for log updates from the main process
      ipcRenderer.on('shader-cache-log', (event, message) => {
        logCounter++;
        
        // Determine message type based on content
        let type = 'info';
        
        if (message.includes('Error:') || message.includes('failed') || message.includes('Could not')) {
          type = 'error';
        } else if (message.includes('Success') || message.includes('successful')) {
          type = 'success';
        } else if (message.includes('Warning') || message.includes('skipped')) {
          type = 'warning';
        } else if (message.includes('Starting') || message.includes('Checking location') || message.includes('Found')) {
          type = 'highlight';
        }
        
        // Add the message to the log
        addCacheLog(message, type);
      });
      
      // Start the cache clearing process with a small delay to ensure UI is ready
      addCacheLog('Initializing shader cache cleanup process...', 'highlight');
      // Small delay to ensure UI is updated before starting the process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await ipcRenderer.invoke('clear-shader-cache-integrated');
      
      // Remove the log listener
      ipcRenderer.removeAllListeners('shader-cache-log');
      
      if (result.success) {
        updateCacheStatus('Success: NVIDIA Shader Cache Cleared', 'success');
        addCacheLog(result.message, 'success');
        addCacheLog(`Total log messages received: ${logCounter}`, 'info');
        
        // Calculate completion percentage
        let completionPercent = 0;
        if (result.stats) {
          const { totalFound, deletedCount } = result.stats;
          if (totalFound > 0) {
            completionPercent = Math.round((deletedCount / totalFound) * 100);
          } else {
            completionPercent = 100; // No files found is 100% complete
          }
        }
        
        updateCacheProgress(completionPercent);
        
        // Hide progress after a delay
        setTimeout(() => {
          updateCacheProgress(0);
        }, 3000);
      } else {
        updateCacheStatus('Error: Failed to Clear Shader Cache', 'error');
        addCacheLog(result.message, 'error');
        updateCacheProgress(0);
      }
    }
  } catch (error) {
    addCacheLog(error.message, 'error');
    updateCacheStatus('Error: Failed to Clear Shader Cache', 'error');
    updateCacheProgress(0);
  } finally {
    startCacheCleanupBtn.disabled = false;
  }
});

// Set up clear cache log button
clearCacheLogBtn.addEventListener('click', () => {
  const confirmation = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Clear Log',
    message: 'Are you sure you want to clear the log history?',
    buttons: ['Cancel', 'Clear Log'],
    defaultId: 0,
    cancelId: 0
  });
  
  if (confirmation === 1) {
    cacheLogElement.innerHTML = '';
    addCacheLog('Log cleared', 'info');
  }
});

// Set up save cache log button
saveCacheLogBtn.addEventListener('click', async () => {
  try {
    // Convert log content to plain text
    let logContent = '';
    const logEntries = cacheLogElement.childNodes;
    
    for (const entry of logEntries) {
      if (entry.textContent) {
        logContent += entry.textContent + '\n';
      }
    }
    
    if (!logContent) {
      addCacheLog('No log content to save', 'warning');
      return;
    }
    
    // Show save dialog
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const result = await dialog.showSaveDialog({
      title: 'Save Shader Cache Cleanup Log',
      defaultPath: `shader-cache-cleanup-${timestamp}.log`,
      filters: [
        { name: 'Log Files', extensions: ['log', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, logContent);
      addCacheLog(`Log saved to ${result.filePath}`, 'success');
    }
  } catch (error) {
    addCacheLog(`Error saving log: ${error.message}`, 'error');
  }
});

// Add initial log entry
addLog('Application started. Please configure paths and select a driver version to continue.');

// Start at the home screen
showScreen(homeScreen); 