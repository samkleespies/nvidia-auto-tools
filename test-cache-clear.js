const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    console.log(`Writing script to: ${tempScriptPath}`);
    
    fs.writeFileSync(tempScriptPath, script);
    
    // Execute PowerShell script
    const psCommand = `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "${tempScriptPath}"`;
    
    console.log('Executing shader cache clearing command...');
    
    exec(psCommand, (error, stdout, stderr) => {
      // Clean up temp file
      try {
        fs.unlinkSync(tempScriptPath);
        console.log('Temp script file deleted');
      } catch (err) {
        console.error('Failed to delete temp script file:', err);
      }
      
      console.log('PowerShell output:');
      console.log(stdout);
      
      if (stderr) {
        console.log('Stderr output:');
        console.log(stderr);
      }
      
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

// Run the test
console.log('Starting NVIDIA shader cache clear test...');
clearNvidiaShaderCache()
  .then(result => {
    console.log('\nTest completed successfully:');
    console.log(result.message);
  })
  .catch(error => {
    console.error('\nTest failed:');
    console.error(error.message);
  }); 