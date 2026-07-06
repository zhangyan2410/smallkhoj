# Inkframe TWD Proof

Status: `failed_route`
Timestamp: `2026-07-06T01:41:13.217Z`

## Notes

- Selector assertions ran through the project WebDriver guard wrappers.
- Mobile selectors are DOM contract checks; viewport resizing is recorded as pending unless the local twd bridge exposes viewport control.
- /chat route proof failed: Expected /chat, but browser is at /chat/gate-lab
- /members route proof failed: Ambiguous local frontend tabs; use or close one before guarded verification:
1617512466 http://127.0.0.1:3000/chat/gate-lab
1617512471 http://127.0.0.1:3000/tasks
- /computers route proof failed: Ambiguous local frontend tabs; use or close one before guarded verification:
1617512466 http://127.0.0.1:3000/chat/gate-lab
1617512471 http://127.0.0.1:3000/tasks
- /settings route proof failed: Ambiguous local frontend tabs; use or close one before guarded verification:
1617512466 http://127.0.0.1:3000/chat/gate-lab
1617512471 http://127.0.0.1:3000/tasks

## Routes

- `/chat`: `failed`
- `/tasks`: `checked` (http://127.0.0.1:3000/tasks)
- `/members`: `failed`
- `/computers`: `failed`
- `/settings`: `failed`

## Selector Checks

- [ ] product-shell / chat shell background surface error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat shell background owner error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat dry desk tint error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat shell background does not capture pointer by default error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat shell background starts without an imported source image error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat workbench header owns foreground contrast error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat main panel owns foreground contrast error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat app background material owner error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat app background material desk tint error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat app background material starts static error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] product-shell / chat app background material does not capture pointer by default error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat workspace error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat sidebar drawer collapsed state marker error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat message list error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat composer error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat messages error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat message actions default hidden error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-desktop / chat message material surfaces error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-mobile / chat mobile workspace marker error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-mobile / chat mobile message list marker error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-mobile / chat mobile composer marker error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-unread / sidebar entities carry unread contract error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] chat-unread / active unread event badges error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] material-state / static material surfaces error="Expected /chat, but browser is at /chat/gate-lab"
- [ ] material-state / static material surfaces do not capture pointer error="Expected /chat, but browser is at /chat/gate-lab"
- [x] product-shell / tasks shell background surface count=1
- [x] product-shell / tasks shell background owner count=2
- [x] product-shell / tasks dry desk tint count=2
- [x] product-shell / tasks shell background does not capture pointer by default count=1
- [x] product-shell / tasks shell background starts without an imported source image count=1
- [x] product-shell / tasks workbench header owns foreground contrast count=1
- [x] product-shell / tasks main panel owns foreground contrast count=1
- [x] product-shell / tasks app background material owner count=1
- [x] product-shell / tasks app background material desk tint count=1
- [x] product-shell / tasks app background material starts static count=1
- [x] product-shell / tasks app background material does not capture pointer by default count=1
- [x] task-desktop / task workspace count=1
- [ ] task-desktop / task controls count=0
- [x] task-desktop / task board count=1
- [x] task-desktop / task tickets count=7
- [x] task-desktop / task evidence objects count=3
- [x] task-desktop / task review objects count=1
- [x] task-mobile / task mobile workspace marker count=1
- [ ] task-mobile / task mobile controls marker count=0
- [x] task-mobile / task mobile board marker count=1
- [x] task-mobile / task detail marker count=1
- [x] task-mobile / task evidence marker count=1
- [x] task-mobile / task review marker count=1
- [x] material-state / task static material surfaces count=8
- [ ] product-shell / members shell background surface error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members shell background owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members dry desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members shell background does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members shell background starts without an imported source image error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members workbench header owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members main panel owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members app background material owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members app background material desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members app background material starts static error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / members app background material does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers shell background surface error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers shell background owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers dry desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers shell background does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers shell background starts without an imported source image error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers workbench header owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers main panel owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers app background material owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers app background material desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers app background material starts static error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / computers app background material does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings shell background surface error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings shell background owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings dry desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings shell background does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings shell background starts without an imported source image error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings workbench header owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings main panel owns foreground contrast error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings app background material owner error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings app background material desk tint error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings app background material starts static error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
- [ ] product-shell / settings app background material does not capture pointer by default error="Ambiguous local frontend tabs; use or close one before guarded verification:\n1617512466 http://127.0.0.1:3000/chat/gate-lab\n1617512471 http://127.0.0.1:3000/tasks"
