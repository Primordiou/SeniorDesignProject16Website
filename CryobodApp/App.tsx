/**
 * Cryobod BLE App
 */

import React, { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Platform,
  Alert,
  ScrollView,
  PermissionsAndroid,
} from 'react-native'
import { BleManager, Device, State } from 'react-native-ble-plx'
import { atob, btoa } from 'react-native-quick-base64'

// Must match ESP BLE service + characteristic
const SERVICE_UUID = '0000ff01-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '0000ff02-0000-1000-8000-00805f9b34fb'
const DEVICE_NAME = 'Nano 2'

const manager = new BleManager()

type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected'

interface LogEntry {
  id: number
  time: string
  message: string
  type: 'info' | 'success' | 'error' | 'data'
}

function timestamp(): string {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes()
    .toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

let logId = 0

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [temp, setTemp] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const deviceRef = useRef<Device | null>(null)
  const statusRef = useRef<ConnectionStatus>('disconnected')
  const isConnectingRef = useRef(false)
  const scanStoppedRef = useRef(false)
  const pulseAnim = useRef(new Animated.Value(1)).current

  const updateStatus = useCallback((next: ConnectionStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [
      { id: logId++, time: timestamp(), message, type },
      ...prev.slice(0, 49),
    ])
  }, [])

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start()
  }, [pulseAnim])

  const stopPulse = useCallback(() => {
    pulseAnim.stopAnimation()
    pulseAnim.setValue(1)
  }, [pulseAnim])

  const handleNotification = useCallback((value: string) => {
    addLog(`← ${value}`, 'data')

    const [key, val] = value.split('=')
    if (!key || !val) return

    if (key.trim() === 'TempF') {
      setTemp(val.trim())
    }
  }, [addLog])

  const requestBlePermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true

    if ((Platform.Version as number) >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ])

      return (
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      )
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    )

    return result === PermissionsAndroid.RESULTS.GRANTED
  }, [])

  const connect = useCallback(async () => {
    if (statusRef.current !== 'disconnected' || isConnectingRef.current) return

    const hasPermissions = await requestBlePermissions()
    if (!hasPermissions) {
      Alert.alert(
        'Permissions Required',
        'Bluetooth permissions are needed to scan for your Cryobod device.'
      )
      addLog('Bluetooth permissions denied', 'error')
      return
    }

    const bleState = await manager.state()
    if (bleState !== State.PoweredOn) {
      Alert.alert('Bluetooth Off', 'Please enable Bluetooth and try again.')
      return
    }

    try {
      const connectedDevices = await manager.connectedDevices([SERVICE_UUID])
      for (const d of connectedDevices) {
        if (d.name === DEVICE_NAME) {
          await d.cancelConnection()
        }
      }
    } catch {}

    scanStoppedRef.current = false
    updateStatus('scanning')
    addLog(`Scanning for ${DEVICE_NAME}...`, 'info')

    manager.startDeviceScan(null, { allowDuplicates: false }, async (error, device) => {
      if (error) {
        addLog(`Scan error: ${error.message}`, 'error')
        updateStatus('disconnected')
        isConnectingRef.current = false
        return
      }

      if (!device || device.name !== DEVICE_NAME) return
      if (isConnectingRef.current || scanStoppedRef.current) return

      isConnectingRef.current = true
      scanStoppedRef.current = true
      manager.stopDeviceScan()

      addLog(`Found ${device.name}, connecting...`, 'info')
      updateStatus('connecting')

      try {
        let connected: Device

        const alreadyConnected = await device.isConnected()
        if (alreadyConnected) {
          connected = device
        } else {
          connected = await device.connect()
        }

        await connected.discoverAllServicesAndCharacteristics()
        deviceRef.current = connected

        connected.onDisconnected(() => {
          addLog('Device disconnected', 'error')
          updateStatus('disconnected')
          setTemp(null)
          stopPulse()
          deviceRef.current = null
          isConnectingRef.current = false
          scanStoppedRef.current = false
        })

        connected.monitorCharacteristicForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          (err, char) => {
            if (err) {
              addLog(`Notify error: ${err.message}`, 'error')
              return
            }

            if (char?.value) {
              const decoded = atob(char.value)
              handleNotification(decoded)
            }
          }
        )

        updateStatus('connected')
        startPulse()
        addLog(`Connected to ${DEVICE_NAME} ✓`, 'success')
      } catch (e: any) {
        addLog(`Connection failed: ${e.message}`, 'error')
        updateStatus('disconnected')
        deviceRef.current = null
      } finally {
        isConnectingRef.current = false
      }
    })

    setTimeout(() => {
      if (statusRef.current === 'scanning' && !scanStoppedRef.current) {
        manager.stopDeviceScan()
        addLog('Device not found - scan timed out', 'error')
        updateStatus('disconnected')
        isConnectingRef.current = false
        scanStoppedRef.current = false
      }
    }, 10000)
  }, [
    addLog,
    handleNotification,
    requestBlePermissions,
    startPulse,
    stopPulse,
    updateStatus,
  ])

  const disconnect = useCallback(async () => {
    try {
      manager.stopDeviceScan()
      if (deviceRef.current) {
        await deviceRef.current.cancelConnection()
      }
    } catch (e: any) {
      addLog(`Disconnect error: ${e.message}`, 'error')
    } finally {
      updateStatus('disconnected')
      setTemp(null)
      stopPulse()
      deviceRef.current = null
      isConnectingRef.current = false
      scanStoppedRef.current = false
    }
  }, [addLog, stopPulse, updateStatus])

  const sendCommand = useCallback(async (cmd: string) => {
    if (!deviceRef.current || statusRef.current !== 'connected') {
      addLog('Cannot send command: not connected', 'error')
      return
    }

    try {
      const encoded = btoa(cmd)

      await deviceRef.current.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        encoded
      )

      addLog(`→ ${cmd}`, 'success')
    } catch (e: any) {
      addLog(`Send failed: ${e.message}`, 'error')
    }
  }, [addLog])

  const isConnected = status === 'connected'
  const isScanning = status === 'scanning' || status === 'connecting'
  const statusColor =
    isConnected ? '#22d3ee' : isScanning ? '#f59e0b' : '#64748b'
  const statusLabel = {
    disconnected: 'Disconnected',
    scanning: 'Scanning...',
    connecting: 'Connecting...',
    connected: 'Connected',
  }[status]

  const logColor = (type: LogEntry['type']) =>
    ({
      info: '#94a3b8',
      success: '#22d3ee',
      error: '#f87171',
      data: '#a78bfa',
    }[type])

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#020c18" />

      <View style={styles.header}>
        <Text style={styles.logo}>
          CRYO<Text style={styles.logoAccent}>BOD</Text>
        </Text>

        <View style={[styles.statusBadge, { borderColor: statusColor }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.tempCard, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.tempLabel}>BODY TEMP</Text>
          <Text style={styles.tempValue}>{temp ? `${temp}°` : '--'}</Text>
          <Text style={styles.tempUnit}>FAHRENHEIT</Text>
        </Animated.View>

        <TouchableOpacity
          style={[styles.connectBtn, isConnected && styles.connectBtnActive]}
          onPress={isConnected ? disconnect : connect}
          disabled={isScanning}
          activeOpacity={0.8}
        >
          <Text style={styles.connectBtnText}>
            {isScanning ? 'SEARCHING...' : isConnected ? 'DISCONNECT' : 'CONNECT DEVICE'}
          </Text>
        </TouchableOpacity>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnOn, !isConnected && styles.controlBtnDisabled]}
            onPress={() => sendCommand('ON')}
            disabled={!isConnected}
            activeOpacity={0.8}
          >
            <Text style={styles.controlBtnText}>PUMP ON</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnOff, !isConnected && styles.controlBtnDisabled]}
            onPress={() => sendCommand('OFF')}
            disabled={!isConnected}
            activeOpacity={0.8}
          >
            <Text style={styles.controlBtnText}>PUMP OFF</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modeRow}>
          {[
            { label: 'LOW', cmd: 'LVL:1' },
            { label: 'MEDIUM', cmd: 'LVL:2' },
            { label: 'HIGH', cmd: 'LVL:3' },
          ].map(item => (
            <TouchableOpacity
              key={item.cmd}
              style={[styles.modeBtn, !isConnected && styles.controlBtnDisabled]}
              onPress={() => sendCommand(item.cmd)}
              disabled={!isConnected}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.logCard}>
          <Text style={styles.logTitle}>EVENT LOG</Text>
          {logs.length === 0 ? (
            <Text style={styles.logEmpty}>No events yet</Text>
          ) : (
            logs.map(entry => (
              <View key={entry.id} style={styles.logRow}>
                <Text style={styles.logTime}>{entry.time}</Text>
                <Text style={[styles.logMsg, { color: logColor(entry.type) }]}>
                  {entry.message}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020c18',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0f2540',
  },
  logo: {
    fontSize: 24,
    fontWeight: '900',
    color: '#f1f5f9',
    letterSpacing: 4,
  },
  logoAccent: {
    color: '#22d3ee',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  scroll: {
    padding: 24,
    gap: 16,
  },
  tempCard: {
    backgroundColor: '#060f1e',
    borderWidth: 1,
    borderColor: '#0f2540',
    borderRadius: 24,
    alignItems: 'center',
    paddingVertical: 40,
    marginBottom: 8,
  },
  tempLabel: {
    fontSize: 11,
    color: '#475569',
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 8,
  },
  tempValue: {
    fontSize: 80,
    fontWeight: '900',
    color: '#22d3ee',
    lineHeight: 88,
  },
  tempUnit: {
    fontSize: 11,
    color: '#475569',
    letterSpacing: 3,
    fontWeight: '600',
    marginTop: 4,
  },
  connectBtn: {
    backgroundColor: '#0f2540',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  connectBtnActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#051525',
  },
  connectBtnText: {
    color: '#f1f5f9',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  controlBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
  },
  controlBtnOn: {
    backgroundColor: '#052e16',
    borderColor: '#16a34a',
  },
  controlBtnOff: {
    backgroundColor: '#2d0a0a',
    borderColor: '#dc2626',
  },
  controlBtnDisabled: {
    opacity: 0.3,
  },
  controlBtnText: {
    color: '#f1f5f9',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modeBtn: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: '#0a1929',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  modeBtnText: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  logCard: {
    backgroundColor: '#060f1e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#0f2540',
    marginTop: 8,
  },
  logTitle: {
    fontSize: 11,
    color: '#475569',
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 12,
  },
  logEmpty: {
    color: '#334155',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },
  logRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#0a1929',
  },
  logTime: {
    color: '#334155',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    minWidth: 64,
  },
  logMsg: {
    fontSize: 12,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
})