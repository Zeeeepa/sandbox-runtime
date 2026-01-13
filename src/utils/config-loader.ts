import * as fs from 'fs'
import {
  SandboxRuntimeConfigSchema,
  type SandboxRuntimeConfig,
} from '../sandbox/sandbox-config.js'
import { logForDebugging } from './debug.js'

/**
 * Delay before re-establishing file watcher after a rename event.
 * On macOS, rename events indicate the file was replaced (new inode).
 * We need to wait for the filesystem to settle before watching the new file.
 */
export const CONFIG_FILE_SETTLE_DELAY_MS = 100

/**
 * Load and validate sandbox configuration from a file
 */
export function loadConfig(filePath: string): SandboxRuntimeConfig | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    if (content.trim() === '') {
      return null
    }

    // Parse JSON
    const parsed = JSON.parse(content)

    // Validate with zod schema
    const result = SandboxRuntimeConfigSchema.safeParse(parsed)

    if (!result.success) {
      console.error(`Invalid configuration in ${filePath}:`)
      result.error.issues.forEach(issue => {
        const path = issue.path.join('.')
        console.error(`  - ${path}: ${issue.message}`)
      })
      return null
    }

    return result.data
  } catch (error) {
    // Log parse errors to help users debug invalid config files
    if (error instanceof SyntaxError) {
      console.error(`Invalid JSON in config file ${filePath}: ${error.message}`)
    } else {
      console.error(`Failed to load config from ${filePath}: ${error}`)
    }
    return null
  }
}

/**
 * Watch config file for changes and call callback with new config
 * Returns cleanup function to stop watching
 */
export function watchConfigFile(
  configPath: string,
  onUpdate: (config: SandboxRuntimeConfig) => void,
): () => void {
  // Only watch if file exists
  if (!fs.existsSync(configPath)) {
    return () => {} // No-op cleanup
  }

  let watcher: fs.FSWatcher | null = null
  let closed = false

  function setupWatcher(): void {
    if (closed || !fs.existsSync(configPath)) {
      return
    }

    watcher = fs.watch(configPath, { persistent: false }, eventType => {
      logForDebugging(`Config file event: ${eventType}`)

      // On macOS, 'rename' means the file was replaced (new inode)
      // The watcher becomes stale, so we need to re-establish it
      if (eventType === 'rename') {
        watcher?.close()
        setTimeout(() => setupWatcher(), CONFIG_FILE_SETTLE_DELAY_MS)
      }

      const newConfig = loadConfig(configPath)
      if (newConfig) {
        onUpdate(newConfig)
        logForDebugging(`Config reloaded from ${configPath}`)
      }
      // If loadConfig returns null (invalid/deleted), keep old config
    })
  }

  setupWatcher()

  return () => {
    closed = true
    watcher?.close()
  }
}
