const parent = process.ppid;
process.stdout.write("LOCKED\n");
setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 250);
