/*
 * ESP32 Vehicle Telemetry - Board 2 Bring-up Test
 * ------------------------------------------------
 * Modules on this board:
 *   - NEO-6M GPS (GY-GPS6MV2)  on UART1
 *   - SIM800L EVB              on UART2  (UART link only - no SIM card this phase)
 *   - MCP2515 CAN module       on VSPI
 *
 * This is a bench bring-up test:
 *   - GPS will give real lat/lng once it sees the sky.
 *   - SIM800L will answer "OK" to AT if it is alive (no SIM needed for that).
 *   - CAN will only print frames if it is on a real bus, OR in LOOPBACK self-test.
 *
 * Serial Monitor baud: 115200
 *
 * Libraries (install via Arduino IDE -> Library Manager):
 *   - "TinyGPSPlus" by Mikal Hart
 *   - "mcp_can"     by coryjfowler
 */

#include <TinyGPSPlus.h>
#include <SPI.h>
#include <mcp_can.h>

// ----------------------- PIN MAP -----------------------
// GPS (UART1)
#define GPS_RX 5      // ESP32 receives  <- GPS  TX   (board pin D5)
#define GPS_TX 4      // ESP32 transmits -> GPS  RX   (board pin D4)

// SIM800L (UART2)
#define SIM_RX 26     // ESP32 receives  <- SIM800L TXD (board pin D26)
#define SIM_TX 27     // ESP32 transmits -> SIM800L RXD (board pin D27)

// MCP2515 CAN over VSPI.
// SCK=18, MISO=19, MOSI=23 are the ESP32's default VSPI pins and are
// wired exactly that way, so they are handled automatically.
#define CAN_CS  32    // board pin D32
#define CAN_INT 33    // board pin D33

// ---- IMPORTANT: match this to YOUR MCP2515 crystal ----
// Read the silver metal can on the module:
//   stamped 8.000  -> MCP_8MHZ      stamped 16.000 -> MCP_16MHZ
// Most blue MCP2515+TJA1050 boards are 8 MHz.
#define CAN_CRYSTAL MCP_8MHZ

// Set to true to self-test CAN on the bench with NO vehicle attached.
// In loopback the controller hears its own transmitted frame, which proves
// the SPI wiring and the chip work without needing a real bus + 120R.
#define CAN_LOOPBACK_TEST false

// ----------------------- OBJECTS -----------------------
TinyGPSPlus    gps;
HardwareSerial GPSserial(1);
HardwareSerial SIMserial(2);
MCP_CAN        CAN(CAN_CS);

bool canReady = false;
unsigned long lastReport = 0;
unsigned long lastCanTx  = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("==========================================");
  Serial.println(" ESP32 Telemetry Board 2 - Bring-up Test");
  Serial.println("==========================================");

  // ---- GPS ----
  GPSserial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  Serial.println("[GPS] UART1 @9600  RX=5  TX=4");

  // ---- SIM800L ----
  SIMserial.begin(9600, SERIAL_8N1, SIM_RX, SIM_TX);
  Serial.println("[SIM] UART2 @9600  RX=26 TX=27");

  // ---- CAN ----
  SPI.begin(18, 19, 23, CAN_CS);   // SCK, MISO, MOSI, CS
  if (CAN.begin(MCP_ANY, CAN_500KBPS, CAN_CRYSTAL) == CAN_OK) {
    if (CAN_LOOPBACK_TEST) {
      CAN.setMode(MCP_LOOPBACK);
      Serial.println("[CAN] MCP2515 init OK @500kbps  (LOOPBACK self-test mode)");
    } else {
      CAN.setMode(MCP_NORMAL);
      Serial.println("[CAN] MCP2515 init OK @500kbps  (NORMAL mode - needs a live bus)");
    }
    pinMode(CAN_INT, INPUT);
    canReady = true;
  } else {
    Serial.println("[CAN] MCP2515 init FAILED");
    Serial.println("      -> check crystal (8 vs 16 MHz) and the SPI/CS/INT wiring");
  }

  // ---- quick SIM800L handshake ----
  Serial.println("[SIM] sending AT (expect 'OK' if the module is alive)...");
  SIMserial.println("AT");

  Serial.println("------------------------------------------");
  Serial.println("Tip: type AT commands in Serial Monitor to talk to SIM800L.");
  Serial.println("Waiting for data...");
  Serial.println();
}

void loop() {
  // ---------- GPS: feed every incoming byte to the parser ----------
  while (GPSserial.available()) {
    gps.encode(GPSserial.read());
  }

  // ---------- SIM800L: print whatever it replies ----------
  while (SIMserial.available()) {
    Serial.write(SIMserial.read());
  }
  // forward anything you type in Serial Monitor straight to the SIM800L
  while (Serial.available()) {
    SIMserial.write(Serial.read());
  }

  // ---------- CAN: in loopback, fire a test frame every 2 s ----------
  if (canReady && CAN_LOOPBACK_TEST && millis() - lastCanTx > 2000) {
    lastCanTx = millis();
    byte testData[8] = {0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04};
    CAN.sendMsgBuf(0x123, 0, 8, testData);
    Serial.println("[CAN] loopback test frame sent (0x123)");
  }

  // ---------- CAN: read a frame whenever INT goes low ----------
  if (canReady && digitalRead(CAN_INT) == LOW) {
    unsigned long rxId;
    unsigned char len = 0;
    unsigned char buf[8];
    if (CAN.readMsgBuf(&rxId, &len, buf) == CAN_OK) {
      Serial.printf("[CAN] ID 0x%03lX  len %d  data:", rxId, len);
      for (int i = 0; i < len; i++) Serial.printf(" %02X", buf[i]);
      Serial.println();
    }
  }

  // ---------- status report every 2 s ----------
  if (millis() - lastReport > 2000) {
    lastReport = millis();
    if (gps.location.isValid()) {
      Serial.printf("[GPS] FIX  lat %.6f  lng %.6f  sats %d  alt %.1fm  spd %.1f km/h  %02d:%02d:%02d UTC\n",
        gps.location.lat(), gps.location.lng(), gps.satellites.value(),
        gps.altitude.meters(), gps.speed.kmph(),
        gps.time.hour(), gps.time.minute(), gps.time.second());
    } else {
      Serial.printf("[GPS] no fix yet  (NMEA chars seen: %lu, sats: %d) - give it a clear sky view\n",
        gps.charsProcessed(), gps.satellites.value());
    }
  }
}
