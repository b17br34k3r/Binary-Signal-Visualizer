// DOM Elements
const binaryInput = document.getElementById("binary-input");
const inputError = document.getElementById("input-error");
const encodingButtons = document.getElementById("encoding-buttons");
const legendDiv = document.getElementById("legend");
const themeToggle = document.getElementById("theme-toggle");
const chartCanvas = document.getElementById("signal-chart");

// State
let currentEncoding = "nrz-l";
let chart = null;

// Encoding Legends
const legends = {
  unipolar: "Unipolar:\n• 1 = High voltage (+V)\n• 0 = Zero voltage (0)",
  "nrz-l":
    "NRZ-L (Non-Return-to-Zero Level):\n• 1 = Low voltage (-V)\n• 0 = High voltage (+V)",
  "nrz-i":
    "NRZ-I (Non-Return-to-Zero Inverted):\n• 1 = Transition at start of bit\n• 0 = No transition",
  manchester:
    "Manchester:\n• 1 = High to Low transition\n• 0 = Low to High transition\n• Always transitions in middle",
  b8zs: "B8ZS (Bipolar with 8-Zero Substitution):\n• Normal: 1 = ±V alternating, 0 = 0V\n• 8 zeros → special pattern with violations to maintain sync",
  hdb3: "HDB3 (High-Density Bipolar 3 Zeros):\n• 4 consecutive zeros → replaced with 000V or B00V (V = violation, B = balancing)",
};

// Encoding Functions
const encodings = {
  unipolar: (bits) => {
    const signal = [];
    for (const bit of bits) {
      const level = bit === "1" ? 1 : 0;
      signal.push(level, level); // Two points per bit
    }
    return signal;
  },

  "nrz-l": (bits) => {
    const signal = [];
    for (const bit of bits) {
      const level = bit === "1" ? -1 : 1;
      signal.push(level, level);
    }
    return signal;
  },

  "nrz-i": (bits) => {
    const signal = [];
    let level = 1; // Initial level
    for (const bit of bits) {
      if (bit === "1") level = -level;
      signal.push(level, level);
    }
    return signal;
  },

  manchester: (bits) => {
    const signal = [];
    for (const bit of bits) {
      if (bit === "1") {
        signal.push(1, -1); // High to low
      } else {
        signal.push(-1, 1); // Low to high
      }
    }
    return signal;
  },

  b8zs: (bits) => {
    const arr = bits.split("");
    let signal = [];
    let lastOnePolarity = 1; // Alternates: +1, -1, +1...

    // Insert B8ZS violations
    for (let i = 0; i < arr.length; ) {
      if (i + 7 < arr.length && arr.slice(i, i + 8).every((b) => b === "0")) {
        // Apply B8ZS: 000V000V where V is same polarity as last 1
        const v = lastOnePolarity;
        signal.push(0, 0, 0, v, 0, 0, 0, -v); // Two violations (opposite signs)
        lastOnePolarity = -v; // Flip after violation
        i += 8;
      } else {
        const bit = arr[i];
        if (bit === "1") {
          const level = lastOnePolarity;
          signal.push(level, level);
          lastOnePolarity = -lastOnePolarity;
        } else {
          signal.push(0, 0);
        }
        i++;
      }
    }
    return signal;
  },

  hdb3: (bits) => {
    const arr = bits.split("");
    let signal = [];
    let lastOnePolarity = 1;
    let consecutiveZeros = 0;
    let balance = 0; // Track DC balance

    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === "1") {
        const level = lastOnePolarity;
        signal.push(level, level);
        lastOnePolarity = -lastOnePolarity;
        balance += level;
        consecutiveZeros = 0;
      } else {
        consecutiveZeros++;
        if (consecutiveZeros === 4) {
          // Replace 4 zeros
          let substitution;
          if (balance >= 0) {
            // Use 000V (negative violation)
            substitution = [0, 0, 0, -lastOnePolarity];
            balance -= lastOnePolarity;
            lastOnePolarity = -lastOnePolarity; // Flip after V
          } else {
            // Use B00V (positive B, negative V)
            const b = -balance > 0 ? -1 : 1;
            const v = b;
            substitution = [b, 0, 0, v];
            balance += b - v;
            lastOnePolarity = -v;
          }
          signal.push(...substitution.flatMap((x) => [x, x])); // Two samples per level
          consecutiveZeros = 0;
        } else {
          signal.push(0, 0);
        }
      }
    }
    return signal;
  },
};

// Chart Renderer
function renderChart(bits, signal) {
  if (chart) chart.destroy();

  const labels = [];
  const data = [];

  // Generate x-axis labels and data
  for (let i = 0; i < bits.length; i++) {
    labels.push(i + 0.5); // Center of bit
    data.push("");
  }

  // Create chart
  chart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels: Array.from({ length: signal.length }, (_, i) => ""),
      datasets: [
        {
          label: "Signal",
          data: signal,
          borderColor: "#3498db",
          borderWidth: 2,
          pointRadius: 0,
          stepped: true,
          fill: false,
        },
      ],
    },
    options: {
      animation: {
        duration: 500,
        easing: "easeInOutCubic",
      },
      scales: {
        y: {
          min: -1.5,
          max: 1.5,
          ticks: {
            stepSize: 1,
            callback: (value) =>
              value === 0
                ? "0"
                : value === 1
                ? "+V"
                : value === -1
                ? "-V"
                : value,
          },
        },
        x: {
          title: {
            display: true,
            text: "Bit Time",
          },
          ticks: {
            callback: (val, index) => {
              if (index % 2 === 0) return Math.floor(index / 2);
              return "";
            },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      layout: {
        padding: 10,
      },
    },
  });

  // Draw bit markers
  const ctx = chartCanvas.getContext("2d");
  chartCanvas.addEventListener("resize", () => drawBitMarkers(chart, bits));
  drawBitMarkers(chart, bits);
}

function drawBitMarkers(chart, bits) {
  const {
    ctx,
    chartArea: { top, bottom, left, right },
    scales: { x, y },
  } = chart;
  ctx.save();

  // Draw vertical lines between bits
  for (let i = 0; i <= bits.length; i++) {
    const xPos = left + ((right - left) * (2 * i)) / (bits.length * 2);
    ctx.beginPath();
    ctx.moveTo(xPos, top);
    ctx.lineTo(xPos, bottom);
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.stroke();
  }

  // Draw bit labels
  for (let i = 0; i < bits.length; i++) {
    const xPos = left + ((right - left) * (2 * i + 1)) / (bits.length * 2);
    ctx.fillStyle = "rgba(52, 152, 219, 0.8)";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(bits[i], xPos, y.getPixelForValue(1.2));
  }

  ctx.restore();
}

// Update UI
function updateUI() {
  // Update legend
  legendDiv.textContent = legends[currentEncoding];

  // Update active button
  document.querySelectorAll("#encoding-buttons button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.encoding === currentEncoding);
  });

  const binary = binaryInput.value.trim();
  if (!binary) return;

  if (!/^[01]+$/.test(binary)) {
    inputError.textContent = "Please enter valid binary (0s and 1s only).";
    return;
  }

  inputError.textContent = "";
  const signal = encodings[currentEncoding](binary);
  renderChart(binary, signal);
}

// Event Listeners
binaryInput.addEventListener("input", updateUI);

encodingButtons.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") {
    currentEncoding = e.target.dataset.encoding;
    updateUI();
  }
});

themeToggle.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark-theme");
  document.body.className = isDark ? "dark-theme" : "light-theme";
  themeToggle.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
  updateUI(); // Re-render chart with new theme
});

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  binaryInput.value = "10101";
  updateUI();
});
