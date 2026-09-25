module.exports = {
  apps: [
    {
      name: 'fetchx',
      script: 'app.py',
      interpreter: 'python',
      env_file: '.env',
      env: {
        PORT: 8899,
        HOST: '0.0.0.0',
      },
      max_memory_restart: '500M',
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: 'fetchx-worker-1',
      script: 'worker.py',
      interpreter: 'python',
      env_file: '.env',
      max_memory_restart: '300M',
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: 'fetchx-worker-2',
      script: 'worker.py',
      interpreter: 'python',
      env_file: '.env',
      max_memory_restart: '300M',
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
