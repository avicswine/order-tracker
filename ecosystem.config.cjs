module.exports = {
  apps: [
    {
      name: 'order-tracker',
      script: 'C:\\Users\\User\\AppData\\Roaming\\npm\\tsx.cmd',
      args: 'src/server.ts',
      cwd: './backend',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '500M',
    },
  ],
}
