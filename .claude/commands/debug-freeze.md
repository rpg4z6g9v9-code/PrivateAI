# Debug UI Freeze

Use when a gesture or modal interaction stops responding on device.

## Checklist

1. Identify what was added just before the freeze
2. Rollback that component/interaction only — confirm freeze is gone
3. Add scoped logs at the interaction entry point and handler:
   - If entry fires but handler doesn't: touch responder conflict
   - If neither fires: component not receiving the event
4. Fix the smallest layer:
   - Nested modals: `setShowA(false)` + `setTimeout(() => setShowB(true), 100)`
   - Gesture + ScrollView: remove the gesture handler
   - Inside modal buttons: use `Pressable`, not `TouchableOpacity`
5. Confirm fix on device
6. Remove debug logs, commit

## Do not
- Rewrite data layer to fix an interaction bug
- Tune ScrollView props when a Swipeable is the actual cause
- Leave debug logs in committed code

Full workflow: `~/Cordelia/skills/debug-rn-freeze.md`
