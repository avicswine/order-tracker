module.exports = {
  apps: [
    {
      name: 'order-tracker',
      script: 'node_modules\\.bin\\tsx.cmd',
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
