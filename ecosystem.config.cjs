module.exports = {
  apps: [
    {
      name: 'order-tracker',
      script: 'npx',
      args: 'tsx src/server.ts',
      cwd: './backend',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // Reinicia automaticamente se consumir mais de 500MB de RAM
      max_memory_restart: '500M',
    },
  ],
}
