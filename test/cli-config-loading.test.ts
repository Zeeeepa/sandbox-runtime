import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadConfig, watchConfigFile } from '../src/utils/config-loader.js'

describe('loadConfig', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'))
    configPath = path.join(tmpDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return null when file does not exist', () => {
    const result = loadConfig('/nonexistent/path/config.json')
    expect(result).toBeNull()
  })

  it('should return null for empty file', () => {
    fs.writeFileSync(configPath, '')
    const result = loadConfig(configPath)
    expect(result).toBeNull()
  })

  it('should return null for whitespace-only file', () => {
    fs.writeFileSync(configPath, '   \n\t  ')
    const result = loadConfig(configPath)
    expect(result).toBeNull()
  })

  it('should return null and log error for invalid JSON', () => {
    fs.writeFileSync(configPath, '{ invalid json }')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = loadConfig(configPath)

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON'),
    )
    consoleSpy.mockRestore()
  })

  it('should return null and log Zod errors for invalid schema', () => {
    // Valid JSON but missing required fields
    fs.writeFileSync(configPath, JSON.stringify({ network: {} }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = loadConfig(configPath)

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid configuration'),
    )
    consoleSpy.mockRestore()
  })

  it('should return valid config for valid file', () => {
    const validConfig = {
      network: { allowedDomains: ['example.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(validConfig))

    const result = loadConfig(configPath)

    expect(result).not.toBeNull()
    expect(result?.network.allowedDomains).toContain('example.com')
  })
})

describe('watchConfigFile', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-test-'))
    configPath = path.join(tmpDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return no-op cleanup if file does not exist initially', () => {
    const callback = vi.fn()
    const stopWatching = watchConfigFile('/nonexistent/config.json', callback)

    // Should return a function
    expect(typeof stopWatching).toBe('function')

    // Calling it should not throw
    stopWatching()
    expect(callback).not.toHaveBeenCalled()
  })

  it('should call callback with new config on valid change', async () => {
    const initialConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(initialConfig))

    const callback = vi.fn()
    const stopWatching = watchConfigFile(configPath, callback)

    // Wait a bit for watcher to be ready
    await new Promise(r => setTimeout(r, 50))

    // Update the config
    const newConfig = {
      network: { allowedDomains: ['example.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(newConfig))

    // Wait for watcher to process
    await new Promise(r => setTimeout(r, 150))

    stopWatching()

    expect(callback).toHaveBeenCalled()
    const calledConfig = callback.mock.calls[0][0]
    expect(calledConfig.network.allowedDomains).toContain('example.com')
  })

  it('should not call callback when file is deleted', async () => {
    const initialConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(initialConfig))

    const callback = vi.fn()
    const stopWatching = watchConfigFile(configPath, callback)

    // Wait a bit for watcher to be ready
    await new Promise(r => setTimeout(r, 50))

    // Delete the file
    fs.unlinkSync(configPath)

    // Wait for watcher to process
    await new Promise(r => setTimeout(r, 150))

    stopWatching()

    // Callback should NOT be called (loadConfig returns null for deleted file)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should not call callback for invalid JSON', async () => {
    const initialConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(initialConfig))

    const callback = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stopWatching = watchConfigFile(configPath, callback)

    // Wait a bit for watcher to be ready
    await new Promise(r => setTimeout(r, 50))

    // Write invalid JSON
    fs.writeFileSync(configPath, '{ invalid json }')

    // Wait for watcher to process
    await new Promise(r => setTimeout(r, 150))

    stopWatching()
    consoleSpy.mockRestore()

    // Callback should NOT be called (loadConfig returns null for invalid JSON)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should not call callback for Zod validation failure', async () => {
    const initialConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(initialConfig))

    const callback = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stopWatching = watchConfigFile(configPath, callback)

    // Wait a bit for watcher to be ready
    await new Promise(r => setTimeout(r, 50))

    // Write valid JSON but invalid schema (missing required fields)
    fs.writeFileSync(configPath, JSON.stringify({ network: {} }))

    // Wait for watcher to process
    await new Promise(r => setTimeout(r, 150))

    stopWatching()
    consoleSpy.mockRestore()

    // Callback should NOT be called (loadConfig returns null for validation failure)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should re-establish watcher after file replacement (rename)', async () => {
    const initialConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(initialConfig))

    const callback = vi.fn()
    const stopWatching = watchConfigFile(configPath, callback)

    // Wait a bit for watcher to be ready
    await new Promise(r => setTimeout(r, 50))

    // Simulate atomic file replacement (write to temp, rename)
    // This is how many editors save files on macOS
    const tempPath = configPath + '.tmp'
    const newConfig = {
      network: { allowedDomains: ['first.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(tempPath, JSON.stringify(newConfig))
    fs.renameSync(tempPath, configPath)

    // Wait for watcher to process and re-establish
    await new Promise(r => setTimeout(r, 200))

    // Now do another update to verify watcher is still active
    const secondConfig = {
      network: { allowedDomains: ['second.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    }
    fs.writeFileSync(configPath, JSON.stringify(secondConfig))

    // Wait for watcher to process
    await new Promise(r => setTimeout(r, 150))

    stopWatching()

    // Should have been called at least twice (once for rename, once for update)
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1)

    // Last call should have second.com
    const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0]
    expect(lastCall.network.allowedDomains).toContain('second.com')
  })
})
