module.exports = {
  apps: [
    {
      name: "book-of-elon",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "book-of-elon-monitor",
      script: "monitor-server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        MONITOR_HOST: "127.0.0.1",
        MONITOR_PORT: 3201,
        MONITOR_TARGET_HOST: "127.0.0.1",
        MONITOR_TARGET_PORT: 3000,
        MONITOR_TARGET_APP: "book-of-elon",
      },
    },
  ],
};
