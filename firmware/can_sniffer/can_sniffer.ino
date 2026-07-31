/*
 * ESP32 CAN Bus Reverse-Engineering Sniffer
 * ------------------------------------------
 * Connects to the vehicle CAN bus via MCP2515 and prints an active,
 * in-place dashboard to the Serial Monitor.
 *
 * IMPORTANT: This uses ANSI escape codes to create the static dashboard
 * and red highlighting. Your Serial Monitor MUST support ANSI codes. 
 * (PlatformIO, PuTTY, and Arduino IDE 2.x support this).
 */

#include <SPI.h>
#include <mcp_can.h>

// ----------------------- PIN MAP -----------------------
// SPI Pins for ESP32 VSPI (Default)
#define SPI_SCK  18
#define SPI_MISO 19
#define SPI_MOSI 23

// MCP2515 Pins
#define CAN_CS   32
#define CAN_INT  33

// MCP2515 Config
// Most blue modules use 8MHz. Change to MCP_16MHZ if yours is different.
#define CAN_CRYSTAL MCP_8MHZ
#define CAN_SPEED   CAN_500KBPS

MCP_CAN CAN(CAN_CS);

// ------------------- SNIFFER CONFIG --------------------
#define MAX_CAN_IDS 128            // Maximum unique CAN IDs to track
#define HIGHLIGHT_DURATION_MS 1000 // How long to highlight changed bytes in RED
#define RENDER_INTERVAL_MS 100     // Dashboard refresh rate (10Hz)

// ANSI Colors
#define ANSI_RED    "\033[91m"
#define ANSI_CYAN   "\033[96m"
#define ANSI_RESET  "\033[0m"
#define ANSI_HOME   "\033[H"       // Move cursor to top-left
#define ANSI_CLEAR  "\033[2J"      // Clear screen
#define ANSI_CLRLN  "\033[K"       // Clear rest of line

struct CanFrameData {
  uint32_t id;
  uint8_t dlc;
  uint8_t data[8];
  unsigned long lastSeen;
  unsigned long lastChanged[8];
  bool active;
};

CanFrameData trackedFrames[MAX_CAN_IDS];
unsigned long lastRenderTime = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize all tracked frames to inactive
  for (int i = 0; i < MAX_CAN_IDS; i++) {
    trackedFrames[i].active = false;
  }

  // Clear screen
  Serial.print(ANSI_CLEAR);
  Serial.print(ANSI_HOME);
  Serial.println(ANSI_CYAN "Initializing MCP2515 CAN Sniffer..." ANSI_RESET);

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, CAN_CS);
  pinMode(CAN_INT, INPUT);

  if (CAN.begin(MCP_ANY, CAN_SPEED, CAN_CRYSTAL) == CAN_OK) {
    CAN.setMode(MCP_NORMAL); // We want to listen to the real bus
    Serial.println(ANSI_CYAN "MCP2515 Initialized Successfully in NORMAL mode." ANSI_RESET);
  } else {
    Serial.println(ANSI_RED "Error Initializing MCP2515! Check wiring and crystal size." ANSI_RESET);
    while (1); // Halt
  }

  delay(2000);
}

void loop() {
  unsigned long currentMillis = millis();

  // 1. Process incoming CAN messages as fast as possible
  while (digitalRead(CAN_INT) == LOW) {
    uint32_t rxId;
    uint8_t len = 0;
    uint8_t rxBuf[8];

    if (CAN.readMsgBuf(&rxId, &len, rxBuf) == CAN_OK) {
      updateFrame(rxId, len, rxBuf, currentMillis);
    }
  }

  // 2. Render dashboard at a fixed interval
  if (currentMillis - lastRenderTime >= RENDER_INTERVAL_MS) {
    lastRenderTime = currentMillis;
    renderDashboard(currentMillis);
  }
}

void updateFrame(uint32_t id, uint8_t len, uint8_t *data, unsigned long currentMillis) {
  int slot = -1;
  int emptySlot = -1;

  // Find existing ID or first empty slot
  for (int i = 0; i < MAX_CAN_IDS; i++) {
    if (trackedFrames[i].active && trackedFrames[i].id == id) {
      slot = i;
      break;
    }
    if (!trackedFrames[i].active && emptySlot == -1) {
      emptySlot = i;
    }
  }

  // If new ID, register it
  if (slot == -1) {
    if (emptySlot == -1) return; // Tracking array full
    slot = emptySlot;
    trackedFrames[slot].id = id;
    trackedFrames[slot].active = true;
    for (int i = 0; i < 8; i++) {
      trackedFrames[slot].data[i] = (i < len) ? data[i] : 0;
      trackedFrames[slot].lastChanged[i] = currentMillis;
    }
  } else {
    // Existing ID, compare bytes
    for (int i = 0; i < len; i++) {
      if (trackedFrames[slot].data[i] != data[i]) {
        trackedFrames[slot].data[i] = data[i];
        trackedFrames[slot].lastChanged[i] = currentMillis;
      }
    }
  }
  
  trackedFrames[slot].dlc = len;
  trackedFrames[slot].lastSeen = currentMillis;
}

// Simple insertion sort for stable rendering
void sortActiveFrames(int* sortedIndices, int& count) {
  count = 0;
  for (int i = 0; i < MAX_CAN_IDS; i++) {
    if (trackedFrames[i].active) {
      sortedIndices[count++] = i;
    }
  }
  
  for (int i = 1; i < count; i++) {
    int key = sortedIndices[i];
    int j = i - 1;
    while (j >= 0 && trackedFrames[sortedIndices[j]].id > trackedFrames[key].id) {
      sortedIndices[j + 1] = sortedIndices[j];
      j = j - 1;
    }
    sortedIndices[j + 1] = key;
  }
}

void renderDashboard(unsigned long currentMillis) {
  // Move cursor home to overwrite screen without flickering
  Serial.print(ANSI_HOME);
  
  Serial.print(ANSI_CYAN "=== ESP32 CAN BUS SNIFFER ===" ANSI_RESET ANSI_CLRLN "\n");
  Serial.print("Press pedals/buttons to find changing bytes (highlighted in RED)." ANSI_CLRLN "\n");
  Serial.print("-------------------------------------------------------" ANSI_CLRLN "\n");
  Serial.print("CAN ID   | DATA BYTES               | LAST SEEN" ANSI_CLRLN "\n");
  Serial.print("-------------------------------------------------------" ANSI_CLRLN "\n");

  int sortedIndices[MAX_CAN_IDS];
  int activeCount = 0;
  sortActiveFrames(sortedIndices, activeCount);

  for (int i = 0; i < activeCount; i++) {
    CanFrameData& frame = trackedFrames[sortedIndices[i]];
    
    // Print ID
    Serial.printf("%04X     | ", frame.id);

    // Print Data Bytes with Highlights
    for (int b = 0; b < 8; b++) {
      if (b < frame.dlc) {
        if (currentMillis - frame.lastChanged[b] < HIGHLIGHT_DURATION_MS) {
          // Changed recently -> RED
          Serial.print(ANSI_RED);
          Serial.printf("%02X " ANSI_RESET, frame.data[b]);
        } else {
          // Static -> Normal
          Serial.printf("%02X ", frame.data[b]);
        }
      } else {
        Serial.print("   "); // Padding for DLC < 8
      }
    }

    // Print last seen
    float seenAgo = (currentMillis - frame.lastSeen) / 1000.0;
    Serial.printf("| %.1fs ago" ANSI_CLRLN "\n", seenAgo);
  }

  // Clear rest of screen below the table
  Serial.print("\033[J");
}
