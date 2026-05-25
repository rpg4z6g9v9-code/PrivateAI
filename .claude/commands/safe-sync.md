# Safe SSD Sync

Mirror PrivateAI to CordelisaSS. Dry-run first, then execute.

## Dry run (always do this first)
```bash
rsync -avn --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='ios/Pods' \
  --exclude='ios/build' \
  --exclude='android/build' \
  --exclude='.expo' \
  --exclude='dist' \
  --exclude='.env' \
  ~/Documents/PrivateAI/ \
  /Volumes/CordelisaSS/Cordelia-Archive/PrivateAI-mirror/
```

## Execute (after reviewing dry-run output)
```bash
rsync -av --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='ios/Pods' \
  --exclude='ios/build' \
  --exclude='android/build' \
  --exclude='.expo' \
  --exclude='dist' \
  --exclude='.env' \
  ~/Documents/PrivateAI/ \
  /Volumes/CordelisaSS/Cordelia-Archive/PrivateAI-mirror/
```

## Never sync
- `.env` — secrets stay on laptop only
- `node_modules`, `ios/Pods` — always rebuild
- `.git` — SSD mirror is not a git remote
