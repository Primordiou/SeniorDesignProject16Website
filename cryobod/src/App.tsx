import { useRef, useState } from 'react'
import { Button } from './assets/components/ui/button'
import { Card, CardContent } from './assets/components/ui/card'
import { Routes, Route } from 'react-router-dom'
import Shop from './pages/Shop'
import Contact from './pages/Contact'

function LandingPage() {
  const [bleStatus, setBleStatus] = useState('Not connected')
  const [deviceName, setDeviceName] = useState('')
  const [characteristic, setCharacteristic] =
    useState<BluetoothRemoteGATTCharacteristic | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [temp, setTemp] = useState('-')

  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null)

  const handleTelemetry = (text: string) => {
    const [key, value] = text.split('=')
    if (!key || !value) return
    if (key.trim() === 'TempF') {
      setTemp(value.trim())
    }
  }

  const connectBLE = async () => {
    try {
      if (!navigator.bluetooth) {
        setBleStatus('Web Bluetooth not supported')
        return
      }

      if (isConnecting || isSending) return

      setIsConnecting(true)
      setBleStatus('Requesting device...')

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'Nano 2' }],
        optionalServices: [0xff01],
      })

      setDeviceName(device.name || 'Unknown device')
      setBleStatus('Connecting...')

      device.addEventListener('gattserverdisconnected', () => {
        setBleStatus('Disconnected')
        setCharacteristic(null)
        serverRef.current = null
      })

      const server = await device.gatt?.connect()
      if (!server) throw new Error('Failed to connect to GATT server')

      serverRef.current = server

      const service = await server.getPrimaryService(0xff01)
      const char = await service.getCharacteristic(0xff02)

      // Auto-enable notifications right after connecting
      char.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic
        const value = target.value
        if (!value) return
        const text = new TextDecoder().decode(value)
        console.log('BLE notify:', text)
        handleTelemetry(text)
      })
      await char.startNotifications()

      setCharacteristic(char)
      setBleStatus('Connected')
    } catch (error) {
      console.error('BLE connect error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      setBleStatus(`Connection failed: ${message}`)
    } finally {
      setIsConnecting(false)
    }
  }

  const sendCommand = async (cmd: 'ON' | 'OFF') => {
    try {
      if (isSending || isConnecting) return

      if (!characteristic) {
        setBleStatus('Not connected')
        return
      }

      if (!serverRef.current?.connected) {
        setBleStatus('Device disconnected')
        setCharacteristic(null)
        return
      }

      setIsSending(true)
      setBleStatus(`Sending ${cmd}...`)

      const data = new TextEncoder().encode(cmd)

      if ('writeValueWithoutResponse' in characteristic) {
        await characteristic.writeValueWithoutResponse(data)
      } else if ('writeValueWithResponse' in characteristic) {
        await characteristic.writeValueWithResponse(data)
      } else {
        await characteristic.writeValue(data)
      }

      setBleStatus(`Sent: ${cmd}`)
      await new Promise((resolve) => setTimeout(resolve, 150))
    } catch (error) {
      console.error(`Failed to send ${cmd}:`, error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      setBleStatus(`Failed to send ${cmd}: ${message}`)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white font-bold">
              C
            </div>
            <span className="text-2xl font-bold">Cryobod</span>
          </div>

          <nav className="hidden gap-8 text-sm font-medium text-slate-600 md:flex">
            <a href="#features" className="hover:text-black">Features</a>
            <a href="#benefits" className="hover:text-black">Benefits</a>
            <a href="#contact" className="hover:text-black">Contact</a>
          </nav>

          <Button
            className="rounded-xl px-5"
            onClick={connectBLE}
            disabled={isConnecting || isSending}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      </header>

      <section className="border-b bg-gradient-to-b from-slate-100 to-cyan-50">
        <div className="mx-auto flex min-h-[720px] max-w-7xl flex-col items-center justify-center px-6 text-center">
          <div className="mb-6 rounded-full border bg-white/70 px-5 py-2 text-sm text-slate-600 shadow-sm">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-cyan-500" />
            BLE cooling control
          </div>

          <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight sm:text-6xl md:text-7xl">
            Stay cool.
            <br />
            <span className="text-cyan-500">Connect smarter.</span>
          </h1>

          <p className="mt-8 max-w-3xl text-xl leading-8 text-slate-600">
            Connect directly to your ESP32 and control Cryobod from your browser.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Button
              size="lg"
              className="rounded-xl px-8"
              onClick={connectBLE}
              disabled={isConnecting || isSending}
            >
              {isConnecting ? 'Connecting...' : 'Connect Device'}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="rounded-xl px-8"
              onClick={() => sendCommand('ON')}
              disabled={!characteristic || isSending || isConnecting}
            >
              {isSending ? 'Sending...' : 'Turn ON'}
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <Button
              variant="outline"
              className="rounded-xl px-8"
              onClick={() => sendCommand('OFF')}
              disabled={!characteristic || isSending || isConnecting}
            >
              {isSending ? 'Sending...' : 'Turn OFF'}
            </Button>
          </div>

          <div className="mt-6 grid w-full max-w-2xl gap-4 text-left sm:grid-cols-2">
            <div className="rounded-xl border bg-white/70 px-6 py-4 shadow-sm">
              <p><strong>Status:</strong> {bleStatus}</p>
              <p><strong>Device:</strong> {deviceName || 'None'}</p>
              <p><strong>Connected:</strong> {serverRef.current?.connected ? 'Yes' : 'No'}</p>
            </div>

            <div className="rounded-xl border bg-white/70 px-6 py-4 shadow-sm">
              <p><strong>Temp:</strong> {temp} F</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="mb-10 text-center text-4xl font-bold">Why Cryobod?</h2>

          <div className="grid gap-6 md:grid-cols-3">
            <Card className="rounded-2xl">
              <CardContent className="p-8">
                <h3 className="mb-3 text-xl font-semibold">Direct BLE connection</h3>
                <p className="text-slate-600">
                  Connect directly from your browser to the ESP32 device.
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-8">
                <h3 className="mb-3 text-xl font-semibold">Live control</h3>
                <p className="text-slate-600">
                  Instantly send ON/OFF commands to your cooling system.
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-8">
                <h3 className="mb-3 text-xl font-semibold">Real-time temperature</h3>
                <p className="text-slate-600">
                  Live temperature readings sent directly from the ESP32 sensor.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/contact" element={<Contact />} />
    </Routes>
  )
}