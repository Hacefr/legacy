const NOTE_COLORS = [0xc24b99, 0x00ffff, 0x12fa05, 0xf9393f]; 
const ARROW_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];

function drawArrowShape(graphics, color, size = 32) {
    graphics.clear();
    graphics.beginFill(color);
    graphics.moveTo(0, -size);
    graphics.lineTo(size * 0.8, size * 0.7);
    graphics.lineTo(0, size * 0.4);
    graphics.lineTo(-size * 0.8, size * 0.7);
    graphics.closePath();
    graphics.endFill();
}

let playState = null;
let activeCountdownTimer = null;

// ==========================================================================
// Stage 1 In-Game Visual Offset & Alignment Editor (Key 7)
// ==========================================================================
class StageEditor {
    constructor(scene) {
        this.scene = scene;
        this.active = false;
        this.selectedKey = null;
        this.selectedObject = null;
        this.history = [];
        this.redoStack = [];
        this.showGrid = true;
        this.showBaseline = true;
        this.sidebarVisible = true;
        this.baselineY = 720;

        // UI references
        this.ui = document.getElementById('editor-ui');
        this.sidebar = document.getElementById('editor-sidebar');
        this.tree = document.getElementById('scene-tree');
        this.lblName = document.getElementById('lbl-selected-name');
        this.lblX = document.getElementById('lbl-coord-x');
        this.lblY = document.getElementById('lbl-coord-y');
        this.lblZ = document.getElementById('lbl-coord-z');
        this.toast = document.getElementById('copy-toast');

        this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
        this.btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
        this.btnUndo = document.getElementById('btn-undo');
        this.btnRedo = document.getElementById('btn-redo');
        this.btnGrid = document.getElementById('btn-toggle-grid');
        this.btnBaseline = document.getElementById('btn-toggle-baseline');
        this.btnCopy = document.getElementById('btn-copy-config');
        this.btnClose = document.getElementById('btn-close-editor');

        // Top graphics layer for editor overlays
        this.editorGraphics = new PIXI.Graphics();
        this.editorGraphics.zIndex = 99999;
        this.scene.worldContainer.addChild(this.editorGraphics);

        // Enable sorting on main stage container
        this.scene.worldContainer.sortableChildren = true;

        this.bindEvents();
    }

    bindEvents() {
        if (this.btnToggleSidebar) this.btnToggleSidebar.onclick = () => this.toggleSidebar();
        if (this.btnCollapseSidebar) this.btnCollapseSidebar.onclick = () => this.toggleSidebar();
        this.btnUndo.onclick = () => this.undo();
        this.btnRedo.onclick = () => this.redo();
        this.btnGrid.onclick = () => {
            this.showGrid = !this.showGrid;
            this.btnGrid.classList.toggle('active', this.showGrid);
            this.renderGuides();
        };
        this.btnBaseline.onclick = () => {
            this.showBaseline = !this.showBaseline;
            this.btnBaseline.classList.toggle('active', this.showBaseline);
            this.renderGuides();
        };
        this.btnCopy.onclick = () => this.copyConfiguration();
        this.btnClose.onclick = () => this.toggle(false);

        // Canvas dragging support
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let objStart = { x: 0, y: 0 };

        app.view.addEventListener('mousedown', (e) => {
            if (!this.active || !this.selectedObject) return;
            const rect = app.view.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) * (1280 / rect.width);
            const clickY = (e.clientY - rect.top) * (720 / rect.height);

            const worldPos = this.scene.worldContainer.toLocal(new PIXI.Point(clickX, clickY));
            isDragging = true;
            dragStart = { x: worldPos.x, y: worldPos.y };
            objStart = { x: this.selectedObject.position.x, y: this.selectedObject.position.y };
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.active || !isDragging || !this.selectedObject) return;
            const rect = app.view.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) * (1280 / rect.width);
            const clickY = (e.clientY - rect.top) * (720 / rect.height);
            const worldPos = this.scene.worldContainer.toLocal(new PIXI.Point(clickX, clickY));

            const dx = Math.round(worldPos.x - dragStart.x);
            const dy = Math.round(worldPos.y - dragStart.y);

            this.selectedObject.position.set(objStart.x + dx, objStart.y + dy);
            this.updateReadout();
            this.renderGuides();
        });

        window.addEventListener('mouseup', () => {
            if (isDragging && this.selectedObject) {
                isDragging = false;
                this.recordMove(this.selectedKey, objStart, {
                    x: this.selectedObject.position.x,
                    y: this.selectedObject.position.y
                });
            }
        });
    }

    toggleSidebar(forceState = null) {
        this.sidebarVisible = (forceState !== null) ? forceState : !this.sidebarVisible;
        this.sidebar.classList.toggle('collapsed', !this.sidebarVisible);
        this.btnToggleSidebar.classList.toggle('active', this.sidebarVisible);
    }

    toggle(forceState = null) {
        this.active = (forceState !== null) ? forceState : !this.active;
        this.ui.classList.toggle('hidden', !this.active);

        if (this.active) {
            Conductor.isPlaying = false;
            if (audioCtx.state === 'running') audioCtx.suspend();
            this.populateTree();
            this.renderGuides();
        } else {
            this.editorGraphics.clear();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            Conductor.isPlaying = true;
        }
    }

    populateTree() {
        this.tree.innerHTML = '';
        const items = [];

        if (this.scene.bf) items.push({ key: 'bf', name: 'Boyfriend (Player)', obj: this.scene.bf.container });
        if (this.scene.dad) items.push({ key: 'dad', name: 'Dad (Opponent)', obj: this.scene.dad.container });
        if (this.scene.gf) items.push({ key: 'gf', name: 'Girlfriend', obj: this.scene.gf.container });

        for (const [k, c] of Object.entries(this.scene.extraChars)) {
            if (c) items.push({ key: k, name: `Extra: ${k}`, obj: c.container });
        }

        for (const [k, p] of Object.entries(this.scene.props)) {
            if (p) items.push({ key: `prop_${k}`, name: `Prop: ${k}`, obj: p });
        }

        // Sort items by current zIndex so the tree reflects exact layer order
        items.sort((a, b) => (b.obj.zIndex || 0) - (a.obj.zIndex || 0));

        items.forEach(it => {
            const row = document.createElement('div');
            row.className = 'tree-item' + (this.selectedKey === it.key ? ' selected' : '');

            const eye = document.createElement('button');
            eye.className = 'eye-btn';
            eye.innerText = it.obj.visible ? '👁' : '🚫';
            eye.onclick = (e) => {
                e.stopPropagation();
                it.obj.visible = !it.obj.visible;
                eye.innerText = it.obj.visible ? '👁' : '🚫';
            };

            const label = document.createElement('span');
            label.className = 'item-label';
            label.innerText = `[${it.obj.zIndex || 0}] ${it.name}`;

            row.appendChild(eye);
            row.appendChild(label);

            row.onclick = () => this.select(it.key, it.obj, it.name);
            this.tree.appendChild(row);
        });
    }

    select(key, obj, name) {
        this.selectedKey = key;
        this.selectedObject = obj;
        this.lblName.innerText = name;
        this.updateReadout();
        this.populateTree();
        this.renderGuides();
    }

    updateReadout() {
        if (!this.selectedObject) {
            this.lblX.innerText = '0';
            this.lblY.innerText = '0';
            if (this.lblZ) this.lblZ.innerText = '0';
            return;
        }
        this.lblX.innerText = Math.round(this.selectedObject.position.x);
        this.lblY.innerText = Math.round(this.selectedObject.position.y);
        if (this.lblZ) this.lblZ.innerText = this.selectedObject.zIndex || 0;
    }

    nudge(dx, dy) {
        if (!this.active || !this.selectedObject) return;
        const prev = { x: this.selectedObject.position.x, y: this.selectedObject.position.y };
        this.selectedObject.position.set(prev.x + dx, prev.y + dy);
        this.updateReadout();
        this.renderGuides();
        this.recordMove(this.selectedKey, prev, { x: prev.x + dx, y: prev.y + dy });
    }

    changeLayer(delta) {
        if (!this.active || !this.selectedObject) return;
        const prevZ = this.selectedObject.zIndex || 0;
        const newZ = prevZ + delta;
        this.selectedObject.zIndex = newZ;

        // Sort all stage elements cleanly within worldContainer
        this.scene.worldContainer.sortChildren();

        this.updateReadout();
        this.populateTree();
        this.renderGuides();

        this.history.push({
            type: 'layer',
            key: this.selectedKey,
            from: prevZ,
            to: newZ
        });
        this.redoStack = [];
    }

    recordMove(key, from, to) {
        if (from.x === to.x && from.y === to.y) return;
        this.history.push({ type: 'pos', key, from, to });
        this.redoStack = [];
    }

    undo() {
        if (!this.active || this.history.length === 0) return;
        const action = this.history.pop();
        const obj = this.getObjectByKey(action.key);
        if (obj) {
            if (action.type === 'layer') {
                obj.zIndex = action.from;
                this.scene.worldContainer.sortChildren();
            } else {
                obj.position.set(action.from.x, action.from.y);
            }
            this.updateReadout();
            this.populateTree();
            this.renderGuides();
            this.redoStack.push(action);
        }
    }

    redo() {
        if (!this.active || this.redoStack.length === 0) return;
        const action = this.redoStack.pop();
        const obj = this.getObjectByKey(action.key);
        if (obj) {
            if (action.type === 'layer') {
                obj.zIndex = action.to;
                this.scene.worldContainer.sortChildren();
            } else {
                obj.position.set(action.to.x, action.to.y);
            }
            this.updateReadout();
            this.populateTree();
            this.renderGuides();
            this.history.push(action);
        }
    }

    getObjectByKey(key) {
        if (key === 'bf') return this.scene.bf.container;
        if (key === 'dad') return this.scene.dad.container;
        if (key === 'gf') return this.scene.gf.container;
        if (this.scene.extraChars[key]) return this.scene.extraChars[key].container;
        if (key.startsWith('prop_')) return this.scene.props[key.replace('prop_', '')];
        return null;
    }

    renderGuides() {
        this.editorGraphics.clear();
        if (!this.active) return;

        // 1. Grid Lines
        if (this.showGrid) {
            this.editorGraphics.lineStyle(1, 0x30363d, 0.4);
            for (let x = -2000; x <= 3000; x += 100) {
                this.editorGraphics.moveTo(x, -2000);
                this.editorGraphics.lineTo(x, 2000);
            }
            for (let y = -2000; y <= 2000; y += 100) {
                this.editorGraphics.moveTo(-2000, y);
                this.editorGraphics.lineTo(3000, y);
            }
        }

        // 2. Floor Baseline
        if (this.showBaseline) {
            this.editorGraphics.lineStyle(3, 0x2ed573, 0.9);
            this.editorGraphics.moveTo(-2000, this.baselineY);
            this.editorGraphics.lineTo(3000, this.baselineY);
        }

        // 3. Selection Bounding Box
        if (this.selectedObject && this.selectedObject.visible) {
            const b = this.selectedObject.getBounds();
            const localTopLeft = this.scene.worldContainer.toLocal(new PIXI.Point(b.x, b.y));
            const w = b.width / this.scene.camZoom;
            const h = b.height / this.scene.camZoom;

            this.editorGraphics.lineStyle(2, 0x00d2d3, 0.9);
            this.editorGraphics.drawRect(localTopLeft.x, localTopLeft.y, w, h);

            this.editorGraphics.lineStyle(2, 0xff4757, 1);
            this.editorGraphics.drawCircle(this.selectedObject.position.x, this.selectedObject.position.y, 6);
        }
    }

    copyConfiguration() {
        const out = {
            stage: this.scene.songItem.stage,
            characters: {
                bf: {
                    position: this.scene.bf ? [Math.round(this.scene.bf.container.x), Math.round(this.scene.bf.container.y)] : [0, 0],
                    zIndex: this.scene.bf ? (this.scene.bf.container.zIndex || 300) : 300
                },
                dad: {
                    position: this.scene.dad ? [Math.round(this.scene.dad.container.x), Math.round(this.scene.dad.container.y)] : [0, 0],
                    zIndex: this.scene.dad ? (this.scene.dad.container.zIndex || 200) : 200
                },
                gf: {
                    position: this.scene.gf ? [Math.round(this.scene.gf.container.x), Math.round(this.scene.gf.container.y)] : [0, 0],
                    zIndex: this.scene.gf ? (this.scene.gf.container.zIndex || 100) : 100
                }
            },
            props: {}
        };

        for (const [k, p] of Object.entries(this.scene.props)) {
            out.props[k] = {
                position: [Math.round(p.position.x), Math.round(p.position.y)],
                zIndex: p.zIndex || 0
            };
        }

        const jsonStr = JSON.stringify(out, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
            this.toast.classList.remove('hidden');
            setTimeout(() => this.toast.classList.add('hidden'), 2200);
        });
    }
}

// ==========================================================================
// PlayState Scene & Gameplay Engine
// ==========================================================================
class PlayStateScene {
    constructor(songItem, dadChar, bfChar, gfChar, stageData, stageProps, stageJson, extraChars = {}) {
        this.songItem = songItem;
        this.speed = songItem.speed || 2.5;

        this.worldContainer = new PIXI.Container();
        this.worldContainer.sortableChildren = true; // Enables flat layer hierarchy
        this.hudContainer = new PIXI.Container();

        this.dad = dadChar;
        this.bf = bfChar;
        this.gf = gfChar;
        this.extraChars = extraChars;

        this.notes = [];
        this.events = [];
        this.receptors = [];
        this.score = 0;
        this.combo = 0;
        this.misses = 0;
        this.totalNotesHit = 0;
        this.totalNotesPossible = 0;
        this.health = 1.0;

        this.gfDanceLeft = false;
        this.props = {};
        this.mistLayers = [];

        this.hesDying = false;
        this.isDark = false;

        this.stageDefaultZoom = (stageJson && stageJson.cameraZoom) ? stageJson.cameraZoom : 0.7;
        this.camZoom = this.stageDefaultZoom;
        this.baseZoom = this.camZoom;

        this.initStageCameras(songItem.id.toLowerCase());
        this.setupStageAndCharacters(stageData, stageProps, stageJson);
        this.setupStrumlines();
        this.parseChartNotes(songItem.chartData);
        this.setupHUD();

        app.stage.addChild(this.worldContainer);
        app.stage.addChild(this.hudContainer);

        // Stage 1 Key 7 Editor
        this.editor = new StageEditor(this);
    }

    initStageCameras(songId) {
        if (songId.includes('49') || songId.includes('suspect')) {
            this.dadCam = [500, 450];
            this.bfCam = [850, 450];
            this.camTargetX = 675;
            this.camTargetY = 450;
        } else if (songId.includes('trot')) {
            this.dadCam = [540, 360];
            this.bfCam = [900, 360];
            this.camTargetX = 720;
            this.camTargetY = 360;
        } else if (songId.includes('lied')) {
            this.dadCam = [640, 460];
            this.bfCam = [810, 460];
            this.camTargetX = 725;
            this.camTargetY = 460;
        } else if (songId.includes('threat')) {
            this.dadCam = [800, 600];
            this.bfCam = [1100, 600];
            this.camTargetX = 950;
            this.camTargetY = 600;
            this.stageDefaultZoom = 0.5;
            this.baseZoom = 0.5;
            this.camZoom = 0.5;
        } else {
            this.dadCam = [600, 450];
            this.bfCam = [850, 450];
            this.camTargetX = 725;
            this.camTargetY = 450;
        }

        this.camFocusX = this.camTargetX;
        this.camFocusY = this.camTargetY;
    }

    // Unified Stage & Character setup: Everything lives directly in worldContainer
    setupStageAndCharacters(stageData, stageProps, stageJson) {
        // 1. Stage Props
        if (stageJson && stageJson.props) {
            stageJson.props.forEach(p => {
                const cleanName = p.assetPath.split('/').pop().toLowerCase();
                const tex = stageData[cleanName];

                if (p.assetPath && p.assetPath.startsWith('#')) {
                    const g = new PIXI.Graphics();
                    const hexColor = parseInt(p.assetPath.replace('#', '0x'), 16) || 0x000000;
                    g.beginFill(hexColor);
                    g.drawRect(-4000, -4000, 10000, 10000);
                    g.endFill();
                    g.alpha = 0;

                    if (p.blend === 'multiply') g.blendMode = PIXI.BLEND_MODES.MULTIPLY;
                    if (p.blend === 'subtract') g.blendMode = PIXI.BLEND_MODES.SUBTRACT;
                    if (p.blend === 'add') g.blendMode = PIXI.BLEND_MODES.ADD;

                    g.zIndex = (p.zIndex !== undefined) ? p.zIndex : 0;
                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = g;
                    this.worldContainer.addChild(g);
                    return;
                }

                const propAnims = stageProps[cleanName];
                let animTextures = null;

                if (propAnims && typeof propAnims === 'object') {
                    const keys = Object.keys(propAnims);
                    if (keys.length > 0) {
                        const targetKey = keys.find(k => k === p.startingAnimation || k === 'idle' || k.includes('bop')) || keys[0];
                        animTextures = propAnims[targetKey] || Object.values(propAnims)[0];
                    }
                }

                if (Array.isArray(animTextures) && animTextures.length > 0) {
                    const aSpr = new PIXI.AnimatedSprite(animTextures);
                    aSpr.position.set(p.position[0], p.position[1]);
                    aSpr.scale.set(p.scale || 1);
                    aSpr.zIndex = (p.zIndex !== undefined) ? p.zIndex : 0;
                    aSpr.alpha = (p.alpha !== undefined) ? p.alpha : 1;
                    
                    const isPlayerShootProp = (cleanName === 'player');
                    aSpr.loop = !isPlayerShootProp;
                    aSpr.animationSpeed = 24 / 60;
                    if (!isPlayerShootProp) {
                        aSpr.play();
                    } else {
                        aSpr.gotoAndStop(0);
                    }

                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = aSpr;
                    this.props[cleanName] = aSpr;
                    this.worldContainer.addChild(aSpr);
                } else if (tex) {
                    const spr = new PIXI.Sprite(tex);
                    spr.position.set(p.position[0], p.position[1]);
                    spr.scale.set(p.scale || 1);
                    spr.alpha = (p.alpha !== undefined) ? p.alpha : 1;
                    if (p.blend === 'subtract') spr.blendMode = PIXI.BLEND_MODES.SUBTRACT;
                    if (p.blend === 'add') spr.blendMode = PIXI.BLEND_MODES.ADD;
                    spr.zIndex = (p.zIndex !== undefined) ? p.zIndex : 0;

                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = spr;
                    this.props[cleanName] = spr;
                    this.worldContainer.addChild(spr);
                }
            });

            // Mist Background
            if (stageData['mistback'] && stageData['mistmid']) {
                const mb = new PIXI.TilingSprite(stageData['mistback'], 4000, 720);
                mb.position.set(-1000, -270);
                mb.alpha = 0.6;
                mb.blendMode = PIXI.BLEND_MODES.SCREEN;
                mb.zIndex = 3;
                this.worldContainer.addChild(mb);
                this.mistLayers.push({ sprite: mb, speed: 15 });

                const mm = new PIXI.TilingSprite(stageData['mistmid'], 4000, 720);
                mm.position.set(-1000, -270);
                mm.alpha = 0.6;
                mm.blendMode = PIXI.BLEND_MODES.SCREEN;
                mm.zIndex = 3;
                this.worldContainer.addChild(mm);
                this.mistLayers.push({ sprite: mm, speed: -15 });
            }
        }

        // 2. Characters (Directly in worldContainer with official zIndex levels)
        const c = (stageJson && stageJson.characters) ? stageJson.characters : null;

        let dadPos = [100, 100];
        let bfPos = [770, 450];
        let gfPos = [400, 130];
        let dadZ = 200;
        let bfZ = 300;
        let gfZ = 100;

        if (c) {
            if (c.dad && Array.isArray(c.dad.position)) { dadPos = c.dad.position; dadZ = c.dad.zIndex || 200; }
            if (c.bf && Array.isArray(c.bf.position)) { bfPos = c.bf.position; bfZ = c.bf.zIndex || 300; }
            if (c.gf && Array.isArray(c.gf.position)) { gfPos = c.gf.position; gfZ = c.gf.zIndex || 100; }
        }

        if (this.gf) {
            this.gf.container.position.set(gfPos[0], gfPos[1]);
            this.gf.container.zIndex = gfZ;
            this.gf.container.visible = !!(c && c.gf);
            this.worldContainer.addChild(this.gf.container);
        }

        if (this.dad) {
            this.dad.container.position.set(dadPos[0], dadPos[1]);
            this.dad.container.zIndex = dadZ;
            this.worldContainer.addChild(this.dad.container);
        }

        if (this.bf) {
            this.bf.container.position.set(bfPos[0], bfPos[1]);
            this.bf.container.zIndex = bfZ;
            this.worldContainer.addChild(this.bf.container);
        }

        if (this.extraChars.maroon) {
            this.extraChars.maroon.container.position.set(-950, 530);
            this.extraChars.maroon.container.zIndex = dadZ + 10;
            this.extraChars.maroon.container.visible = false;
            this.worldContainer.addChild(this.extraChars.maroon.container);
        }
        if (this.extraChars.grey) {
            this.extraChars.grey.container.position.set(-700, 600);
            this.extraChars.grey.container.zIndex = dadZ + 20;
            this.extraChars.grey.container.visible = false;
            this.worldContainer.addChild(this.extraChars.grey.container);
        }
        if (this.extraChars.maroonParasite) {
            this.extraChars.maroonParasite.container.position.set(-350, 240);
            this.extraChars.maroonParasite.container.zIndex = dadZ + 10;
            this.extraChars.maroonParasite.container.visible = false;
            this.worldContainer.addChild(this.extraChars.maroonParasite.container);
        }

        // Initial clean sort of all world layers
        this.worldContainer.sortChildren();
    }

    setupStrumlines() {
        const startX_Opponent = 96;
        const startX_Player = 1280 - 96 - (4 * 110);
        const receptorY = 85;
        const spacing = 110;

        for (let i = 0; i < 8; i++) {
            const isPlayer = i >= 4;
            const dir = i % 4;
            const x = (isPlayer ? startX_Player : startX_Opponent) + (dir * spacing);

            const receptor = new PIXI.Container();
            receptor.position.set(x, receptorY);

            const base = new PIXI.Graphics();
            base.lineStyle(4, 0x3d4457, 1);
            base.drawCircle(0, 0, 42);
            receptor.addChild(base);

            const arrow = new PIXI.Graphics();
            drawArrowShape(arrow, 0x8a95aa, 28);
            arrow.rotation = ARROW_ANGLES[dir];
            receptor.addChild(arrow);

            this.receptors.push({ container: receptor, dir, isPlayer, arrow, base });
            this.hudContainer.addChild(receptor);
        }
    }

    parseChartNotes(chart) {
        this.notes = [];
        this.events = [];
        if (!chart) return;

        const data = chart.chartData || chart;

        if (data.events && Array.isArray(data.events)) {
            data.events.forEach(evt => {
                if (evt.t !== undefined) {
                    this.events.push({ time: evt.t, name: evt.e, val: evt.v, fired: false });
                }
            });
            this.events.sort((a, b) => a.time - b.time);
        }

        if (data.notes && typeof data.notes === 'object') {
            const diffNotes = data.notes.hard || data.notes.normal || Object.values(data.notes)[0] || [];
            diffNotes.forEach(n => {
                const rawDir = n.d !== undefined ? n.d : (n.dir || 0);
                this.notes.push({
                    time: n.t !== undefined ? n.t : n.time,
                    dir: rawDir % 4,
                    isPlayer: (rawDir < 4),
                    kind: n.k || '',
                    sustain: n.l !== undefined ? n.l : (n.sLen || 0),
                    hit: false, missed: false, sprite: null, tailSprite: null
                });
            });
        }

        this.notes.sort((a, b) => a.time - b.time);

        this.notes.forEach(n => {
            const spr = new PIXI.Graphics();
            drawArrowShape(spr, NOTE_COLORS[n.dir], 32);
            spr.rotation = ARROW_ANGLES[n.dir];
            spr.visible = false;
            this.hudContainer.addChild(spr);
            n.sprite = spr;

            if (n.sustain > 50) {
                const tail = new PIXI.Graphics();
                tail.visible = false;
                this.hudContainer.addChildAt(tail, 0);
                n.tailSprite = tail;
            }
        });
    }

    setupHUD() {
        this.healthBarCont = new PIXI.Container();
        this.healthBarCont.position.set(640, 660);

        this.barWidth = 600;
        this.barHeight = 16;

        this.barBorder = new PIXI.Graphics();
        this.barBorder.beginFill(0x000000);
        this.barBorder.drawRect(-this.barWidth / 2 - 4, -this.barHeight / 2 - 4, this.barWidth + 8, this.barHeight + 8);
        this.barBorder.endFill();
        this.healthBarCont.addChild(this.barBorder);

        this.barFill = new PIXI.Graphics();
        this.healthBarCont.addChild(this.barFill);

        this.scoreText = new PIXI.Text('Score: 0 | Misses: 0 | Accuracy: ?', {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 16,
            fontWeight: 'bold',
            fill: 0xffffff,
            align: 'center'
        });
        this.scoreText.anchor.set(0.5);
        this.scoreText.position.set(640, 690);
        this.hudContainer.addChild(this.scoreText);

        this.ratingText = new PIXI.Text('READY!', {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 48,
            fontWeight: 'bold',
            fill: 0x00d2d3,
            align: 'center'
        });
        this.ratingText.anchor.set(0.5);
        this.ratingText.position.set(640, 350);
        this.hudContainer.addChild(this.ratingText);

        this.hudContainer.addChild(this.healthBarCont);
        this.updateHealthBar();
    }

    updateHealthBar() {
        const bw = this.barWidth;
        const bh = this.barHeight;
        const pct = Math.max(0, Math.min(2.0, this.health)) / 2.0;

        this.barFill.clear();
        this.barFill.beginFill(this.isDark ? 0x000000 : 0x800080);
        this.barFill.drawRect(-bw / 2, -bh / 2, bw, bh);
        this.barFill.endFill();

        const bfWidth = bw * pct;
        this.barFill.beginFill(this.isDark ? 0x000000 : 0x31b0d5);
        this.barFill.drawRect(bw / 2 - bfWidth, -bh / 2, bfWidth, bh);
        this.barFill.endFill();
    }

    triggerEvent(e) {
        const name = e.name;
        const val = e.val || {};

        switch(name) {
            case 'FocusCamera':
                if (val.char === 1) {
                    this.camTargetX = this.dadCam[0];
                    this.camTargetY = this.dadCam[1];
                } else if (val.char === 0) {
                    this.camTargetX = this.bfCam[0];
                    this.camTargetY = this.bfCam[1];
                } else if (val.char === -1 && val.x !== undefined && val.y !== undefined) {
                    this.camTargetX = val.x;
                    this.camTargetY = (val.y < 600) ? val.y : val.y;
                }
                break;

            case 'ClassicCameraZoom':
            case 'ZoomCamera':
                if (val.zoom !== undefined) {
                    const isDirect = (val.mode === 'direct');
                    this.baseZoom = isDirect ? val.zoom : (this.stageDefaultZoom * val.zoom);
                }
                break;

            case 'ChangeSuffix':
                if (val.char === 'dad' && this.dad) this.dad.idleSuffix = val.suffix || '';
                if (val.char === 'bf' && this.bf) this.bf.idleSuffix = val.suffix || '';
                break;

            case 'PlayAnimation':
                if (val.target === 'dad' && this.dad) this.dad.playAnim(val.anim, true);
                if (val.target === 'bf' && this.bf) this.bf.playAnim(val.anim, true);
                break;
        }
    }

    update(deltaSec) {
        if (!Conductor.isPlaying || (this.editor && this.editor.active)) return;

        const songPos = Conductor.songPosition;
        const receptorY = 85;
        const scrollMult = 0.32 * this.speed;

        if (this.dad) this.dad.update(deltaSec);
        if (this.bf) this.bf.update(deltaSec);
        if (this.gf && this.gf.container.visible) this.gf.update(deltaSec);

        if (this.extraChars.maroon && this.extraChars.maroon.container.visible) this.extraChars.maroon.update(deltaSec);
        if (this.extraChars.grey && this.extraChars.grey.container.visible) this.extraChars.grey.update(deltaSec);
        if (this.extraChars.maroonParasite && this.extraChars.maroonParasite.container.visible) this.extraChars.maroonParasite.update(deltaSec);

        this.mistLayers.forEach(m => {
            m.sprite.tilePosition.x += m.speed * deltaSec;
        });

        for (let i = 0; i < this.events.length; i++) {
            const e = this.events[i];
            if (!e.fired && songPos >= e.time) {
                e.fired = true;
                this.triggerEvent(e);
            }
        }

        this.camFocusX += (this.camTargetX - this.camFocusX) * 0.05;
        this.camFocusY += (this.camTargetY - this.camFocusY) * 0.05;
        this.camZoom += (this.baseZoom - this.camZoom) * 0.08;

        this.worldContainer.scale.set(this.camZoom);
        this.worldContainer.pivot.set(this.camFocusX, this.camFocusY);
        this.worldContainer.position.set(640, 360);

        this.receptors.forEach(r => {
            r.container.scale.x += (1.0 - r.container.scale.x) * 0.2;
            r.container.scale.y += (1.0 - r.container.scale.y) * 0.2;
        });

        for (let i = 0; i < this.notes.length; i++) {
            const n = this.notes[i];
            if (n.hit || n.missed) continue;

            const diff = n.time - songPos;

            // Opponent Hit
            if (!n.isPlayer && diff <= 0) {
                n.hit = true;
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
                this.hitReceptor(n.dir, false);

                if (this.songItem.id.includes('lied') && this.health > 0.2) {
                    this.health = Math.max(0.2, this.health - 0.02);
                    this.updateHealthBar();
                }

                const anims = ['left', 'down', 'up', 'right'];
                const animToPlay = anims[n.dir];

                if (n.kind === 'maroon' && this.extraChars.maroon && this.extraChars.maroon.container.visible) {
                    this.extraChars.maroon.playAnim(animToPlay, true);
                } else if (n.kind === 'grey' && this.extraChars.grey && this.extraChars.grey.container.visible) {
                    this.extraChars.grey.playAnim(animToPlay, true);
                } else if (n.kind === 'maroonP' && this.extraChars.maroonParasite && this.extraChars.maroonParasite.container.visible) {
                    this.extraChars.maroonParasite.playAnim(animToPlay, true);
                } else if (this.dad) {
                    this.dad.playAnim(animToPlay + (this.dad.idleSuffix || ''), true);
                }
                continue;
            }

            // Player Miss
            if (n.isPlayer && diff < -150) {
                n.missed = true;
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
                this.combo = 0;
                this.misses++;
                this.health = Math.max(0.0, this.health - 0.09);
                this.score = Math.max(0, this.score - 100);

                this.showRating("MISS", 0xff334b);
                this.updateScore();
                this.updateHealthBar();

                const missAnims = ['singleftmiss', 'singdownmiss', 'singupmiss', 'singrightmiss'];
                if (this.bf) this.bf.playAnim(missAnims[n.dir] || 'singleftmiss', true);
                continue;
            }

            // Draw Note
            if (diff > -200 && diff < 1600) {
                const targetReceptor = this.receptors[n.isPlayer ? n.dir + 4 : n.dir];
                const noteY = receptorY + (diff * scrollMult);

                n.sprite.position.set(targetReceptor.container.x, noteY);
                n.sprite.visible = true;

                if (n.tailSprite) {
                    const tailHeight = n.sustain * scrollMult;
                    n.tailSprite.clear();
                    n.tailSprite.beginFill(NOTE_COLORS[n.dir], 0.6);
                    n.tailSprite.drawRect(-8, 0, 16, tailHeight);
                    n.tailSprite.endFill();
                    n.tailSprite.position.set(targetReceptor.container.x, noteY);
                    n.tailSprite.visible = true;
                }
            } else {
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
            }
        }
    }

    hitReceptor(dir, isPlayer) {
        const r = this.receptors[isPlayer ? dir + 4 : dir];
        r.container.scale.set(1.22);
        drawArrowShape(r.arrow, NOTE_COLORS[dir], 32);
        setTimeout(() => drawArrowShape(r.arrow, 0x8a95aa, 28), 110);
    }

    onKeyPress(dir) {
        if (this.editor && this.editor.active) return;
        const songPos = Conductor.songPosition;
        this.hitReceptor(dir, true);
        
        const anims = ['left', 'down', 'up', 'right'];
        if (this.bf) this.bf.playAnim(anims[dir], true);

        if (this.hesDying && this.health > 0.2) {
            this.health = Math.max(0.2, this.health - 0.035);
            this.updateHealthBar();
        }

        let closest = null;
        let minDiff = Infinity;

        for (let i = 0; i < this.notes.length; i++) {
            const n = this.notes[i];
            if (n.isPlayer && n.dir === dir && !n.hit && !n.missed) {
                const diff = Math.abs(n.time - songPos);
                if (diff < minDiff && diff <= 150) {
                    minDiff = diff;
                    closest = n;
                }
            }
        }

        if (closest) {
            closest.hit = true;
            closest.sprite.visible = false;
            if (closest.tailSprite) closest.tailSprite.visible = false;
            this.combo++;
            this.totalNotesHit++;
            this.totalNotesPossible++;
            this.health = Math.min(2.0, this.health + 0.045);

            if (minDiff <= 22.5) { this.score += 400; this.showRating("EPIC!", 0x66fcf1); }
            else if (minDiff <= 45) { this.score += 350; this.showRating("SICK!", 0x00d2d3); }
            else if (minDiff <= 90) { this.score += 200; this.showRating("GOOD", 0x2ed573); }
            else { this.score += 50; this.showRating("BAD", 0xffa502); }

            this.updateScore();
            this.updateHealthBar();
        }
    }

    showRating(text, color) {
        this.ratingText.text = text;
        this.ratingText.style.fill = color;
        this.ratingText.scale.set(1.35);
    }

    updateScore() {
        const acc = this.totalNotesPossible > 0 ? ((this.totalNotesHit / this.totalNotesPossible) * 100).toFixed(1) : '100';
        this.scoreText.text = `Score: ${this.score} | Misses: ${this.misses} | Accuracy: ${acc}%`;
    }

    destroy() {
        if (this.editor && this.editor.active) this.editor.toggle(false);
        app.stage.removeChild(this.worldContainer);
        app.stage.removeChild(this.hudContainer);
        this.worldContainer.destroy({ children: true });
        this.hudContainer.destroy({ children: true });
        revokeAllBlobUrls();
        app.renderer.textureGC.run();
    }
}

// Stage Step Directors
function onStepHit(step) {
    if (!playState) return;
    const currentSong = playState.songItem.id.toLowerCase();

    // 1. "49"
    if (currentSong.includes('49')) {
        if (step >= 993) {
            if (playState.props['graypet']) playState.props['graypet'].alpha = 0.001;
            if (playState.props['tawny']) playState.props['tawny'].alpha = 0.001;
            if (playState.props['deadtawny']) playState.props['deadtawny'].alpha = 1;
            playState.dadCam = [270, 450];
        }
    }

    // 2. "Suspect"
    if (currentSong.includes('suspect')) {
        if (step >= 48 && step < 64) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 1;
            playState.hudContainer.visible = false;
        }
        if (step >= 60 && step < 64) {
            if (playState.props['discuss']) playState.props['discuss'].alpha = 1;
        }
        if (step >= 64) {
            if (playState.props['discuss']) playState.props['discuss'].alpha = 0;
            if (playState.props['loblack']) playState.props['loblack'].alpha = 0;
            playState.hudContainer.visible = true;
        }

        if (step === 448 || step === 464 || step === 480) {
            playState.camTargetX = 500; playState.camTargetY = 450;
        }
        if (step === 460 || step === 476 || step === 492) {
            playState.camTargetX = 850; playState.camTargetY = 450;
        }

        if (step === 805) {
            if (playState.bf) playState.bf.playAnim('lock in', true);
            if (playState.props['player'] && typeof playState.props['player'].gotoAndPlay === 'function') {
                playState.props['player'].loop = false;
                playState.props['player'].gotoAndPlay(0);
            }
        }
        if (step === 812) {
            if (playState.bf) playState.bf.playAnim('cock', true);
            if (playState.dad) playState.dad.playAnim('singright', true);
        }
        if (step === 816) {
            if (playState.bf) playState.bf.playAnim('blast', true);
            if (playState.dad) playState.dad.playAnim('shock', true);
        }
    }

    // 3. "Trot Away"
    if (currentSong.includes('trot')) {
        if (step === 840) {
            playState.isDark = true;
            if (playState.props['subtract']) playState.props['subtract'].alpha = 0.5;
            playState.updateHealthBar();
        }
        if (step === 1096) {
            playState.isDark = false;
            if (playState.props['caught']) playState.props['caught'].alpha = 1;
            if (playState.props['subtract']) playState.props['subtract'].alpha = 0.11;
            playState.updateHealthBar();
        }
    }

    // 4. "Don't Lied"
    if (currentSong.includes('lied')) {
        if (step === 1184) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 1;
            if (playState.gf) playState.gf.container.alpha = 0.001;
            if (playState.dad) playState.dad.idleSuffix = '-alt';
        }
        if (step === 1232) {
            if (playState.dad) playState.dad.container.position.x = 690;
        }
        if (step === 1376) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 0;
            if (playState.gf) playState.gf.container.alpha = 1;
        }
        if (step === 1394) {
            playState.hesDying = true;
            if (playState.dad) playState.dad.playAnim('stab', true);
        }
        if (step === 1396) {
            if (playState.props['blooodfuckkk']) {
                playState.props['blooodfuckkk'].alpha = 0.8;
                setTimeout(() => { if (playState.props['blooodfuckkk']) playState.props['blooodfuckkk'].alpha = 0.2; }, 100);
            }
            if (playState.gf) playState.gf.playAnim('sad', true);
        }
        if (step === 1408) {
            if (playState.dad) playState.dad.idleSuffix = '-fart';
            if (playState.props['loblack2']) playState.props['loblack2'].alpha = 0.6;
        }
    }

    // 5. "Triple Threat"
    if (currentSong.includes('threat')) {
        if (step === 240) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.container.visible = true;
            if (playState.dad) playState.dad.playAnim('wow', true);
            playState.dadCam = [750, 600];
        }
        if (step === 680) {
            playVideoCutscene('tthreat');
        }
        if (step === 690) {
            if (playState.extraChars.grey) playState.extraChars.grey.container.visible = true;
            playState.dadCam = [450, 600];
        }
        if (step === 1300) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.playAnim('shift', true);
        }
        if (step === 1304) {
            if (playState.bf) playState.bf.playAnim('hey', true);
        }
        if (step === 1320) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.container.visible = false;
            if (playState.extraChars.maroonParasite) playState.extraChars.maroonParasite.container.visible = true;
            playState.dadCam = [700, 600];
        }
        if (step === 1848) {
            if (playState.dad) playState.dad.playAnim('bruh', true);
        }
        if (step === 2064) {
            if (playState.dad) playState.dad.playAnim('holy shit', true);
        }
    }
}

function onBeatHit(beat) {
    if (!playState) return;
    const currentSong = playState.songItem.id.toLowerCase();

    if (currentSong.includes('49')) {
        if (beat % 2 === 0 && playState.props['shit'] && typeof playState.props['shit'].gotoAndPlay === 'function') {
            playState.props['shit'].gotoAndPlay(0);
        }
        if (beat % 1 === 0) {
            if (playState.props['tawny'] && typeof playState.props['tawny'].gotoAndPlay === 'function') {
                playState.props['tawny'].gotoAndPlay(0);
            }
            if (playState.props['graypet'] && typeof playState.props['graypet'].gotoAndPlay === 'function') {
                playState.props['graypet'].gotoAndPlay(0);
            }
        }
    }

    if (currentSong.includes('trot') && beat % 2 === 0 && playState.props['caught'] && typeof playState.props['caught'].gotoAndPlay === 'function') {
        playState.props['caught'].gotoAndPlay(0);
    }

    if (playState.gf && playState.gf.container.visible) {
        playState.gfDanceLeft = !playState.gfDanceLeft;
        playState.gf.playAnim(playState.gfDanceLeft ? 'danceleft' : 'danceright', true);
    }

    if (playState.dad && playState.dad.holdTimer <= 0) playState.dad.playAnim('idle');
    if (playState.bf && playState.bf.holdTimer <= 0) playState.bf.playAnim('idle');

    if (playState.extraChars.maroon && playState.extraChars.maroon.holdTimer <= 0) playState.extraChars.maroon.playAnim('idle');
    if (playState.extraChars.grey && playState.extraChars.grey.holdTimer <= 0) playState.extraChars.grey.playAnim('idle');
    if (playState.extraChars.maroonParasite && playState.extraChars.maroonParasite.holdTimer <= 0) playState.extraChars.maroonParasite.playAnim('idle');

    playState.receptors.forEach(r => r.container.scale.set(1.06));
}

app.ticker.add((delta) => {
    const deltaSec = delta / 60;
    Conductor.update();

    if (playState) {
        playState.update(deltaSec);
        if (playState.ratingText && playState.ratingText.scale.x > 1.0) {
            playState.ratingText.scale.x -= delta * 0.05;
            playState.ratingText.scale.y -= delta * 0.05;
        }
    }
});

const KEY_MAP = {
    'KeyD': 0, 'ArrowLeft': 0,
    'KeyF': 1, 'ArrowDown': 1,
    'KeyJ': 2, 'ArrowUp': 2,
    'KeyK': 3, 'ArrowRight': 3
};

window.addEventListener('keydown', (e) => {
    // Key 7: Toggle Stage 1 Visual Offset Editor
    if (e.key === '7' && playState) {
        playState.editor.toggle();
        return;
    }

    // Editor Shortcuts
    if (playState && playState.editor && playState.editor.active) {
        if (e.key === 'Escape') {
            playState.editor.toggle(false);
            return;
        }

        // H key: Toggle Sidebar
        if (e.key.toLowerCase() === 'h') {
            playState.editor.toggleSidebar();
            return;
        }

        // ` (Backtick): Layer Forward (+1)
        if (e.code === 'Backquote' || e.key === '`') {
            playState.editor.changeLayer(1);
            e.preventDefault();
            return;
        }

        // \ (Backslash): Layer Backward (-1)
        if (e.code === 'Backslash' || e.key === '\\') {
            playState.editor.changeLayer(-1);
            e.preventDefault();
            return;
        }

        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            if (e.shiftKey) playState.editor.redo();
            else playState.editor.undo();
            return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'y') {
            playState.editor.redo();
            return;
        }

        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') { playState.editor.nudge(-step, 0); e.preventDefault(); return; }
        if (e.key === 'ArrowRight') { playState.editor.nudge(step, 0); e.preventDefault(); return; }
        if (e.key === 'ArrowUp') { playState.editor.nudge(0, -step); e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { playState.editor.nudge(0, step); e.preventDefault(); return; }
    }

    if (e.key === 'Escape') {
        returnToFreeplay();
        return;
    }

    if (playState && KEY_MAP[e.code] !== undefined) {
        if (!e.repeat) playState.onKeyPress(KEY_MAP[e.code]);
    }
});

async function loadAnimatedProp(stageFolder, propName) {
    let pngEntry = null;
    let xmlEntry = null;

    for (const [path, entry] of Object.entries(VirtualFS.assets)) {
        if (path.includes(`bg/${stageFolder}/`) || path.includes(`bg/`)) {
            if (path.endsWith(`/${propName}.png`) || path.endsWith(`${propName}.png`)) pngEntry = entry;
            if (path.endsWith(`/${propName}.xml`) || path.endsWith(`${propName}.xml`)) xmlEntry = entry;
        }
    }

    if (pngEntry && xmlEntry) {
        try {
            const pngBlob = await pngEntry.async('blob');
            const xmlRaw = await xmlEntry.async('string');
            const xmlClean = xmlRaw.replace(/^\uFEFF/, '').trim();
            const imgUrl = createTrackedBlobUrl(pngBlob);
            const tex = await PIXI.Texture.fromURL(imgUrl);
            const xmlDoc = new DOMParser().parseFromString(xmlClean, 'text/xml');
            return parseSparrowAtlas(tex.baseTexture, xmlDoc);
        } catch(e) {
            console.warn("Failed loading animated prop:", propName, e);
        }
    }
    return null;
}

async function launchSong(item) {
    if (activeCountdownTimer) {
        clearTimeout(activeCountdownTimer);
        activeCountdownTimer = null;
    }

    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    Conductor.stop();
    Conductor.setBPM(item.bpm);

    freeplayScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');

    if (playState) {
        playState.destroy();
        playState = null;
    }

    const songId = item.id.toLowerCase();
    const cleanId = songId.replace(/[^a-z0-9]/g, '');

    if (songId.includes('49')) await playVideoCutscene('49');
    else if (songId.includes('suspect')) await playVideoCutscene('suspect');
    else if (songId.includes('lied')) await playVideoCutscene('dontlied');

    try {
        if (!VirtualFS.audioBufferCache[cleanId]) {
            const audioToLoad = [];
            for (const [path, entry] of Object.entries(VirtualFS.assets)) {
                const cleanPath = path.replace(/[^a-z0-9\/\.]/g, '');
                if (cleanPath.includes(`/${cleanId}/`) || cleanPath.includes(`songs/${cleanId}`)) {
                    if (cleanPath.endsWith('.ogg')) audioToLoad.push(entry);
                }
            }

            const decodedBuffers = [];
            for (const entry of audioToLoad) {
                const buffer = await entry.async('arraybuffer');
                const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
                decodedBuffers.push(decoded);
            }
            VirtualFS.audioBufferCache[cleanId] = decodedBuffers;
        }

        for (const decoded of VirtualFS.audioBufferCache[cleanId]) {
            const source = audioCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(audioCtx.destination);
            Conductor.activeSources.push(source);
        }

        let opponentName = item.player2;
        if (cleanId === '49' || cleanId.includes('49')) opponentName = 'noob49';

        const dadChar = await loadCharacter(opponentName, false, false);
        const bfChar = await loadCharacter(item.player1, true, false);
        
        let gfName = 'gfweird';
        if (songId.includes('suspect')) gfName = 'deadnoob49';
        else if (songId.includes('trot')) gfName = 'gfweird-sheriff';

        const gfChar = await loadCharacter(gfName, false, true);

        const extraChars = {};
        if (cleanId.includes('threat')) {
            extraChars.maroon = await loadCharacter('maroonthreat', false, false);
            extraChars.grey = await loadCharacter('greythreat', false, false);
            extraChars.maroonParasite = await loadCharacter('maroonParasite', false, false);
        }

        const stageData = {};
        const stageFolder = (item.stage || 'security').toLowerCase().includes('sec') ? 'security' : (item.stage || 'security').toLowerCase();
        const stageJson = VirtualFS.stageJsons[item.stage] || VirtualFS.stageJsons[stageFolder] || null;

        for (const [path, entry] of Object.entries(VirtualFS.assets)) {
            if (path.includes(`bg/${stageFolder}/`)) {
                const key = path.split('/').pop().replace(/\.(png|jpg)$/, '');
                if (path.endsWith('.png') || path.endsWith('.jpg')) {
                    const blob = await entry.async('blob');
                    const imgUrl = createTrackedBlobUrl(blob);
                    stageData[key] = await PIXI.Texture.fromURL(imgUrl);
                }
            }
        }

        const stageProps = {};
        for (const path of Object.keys(VirtualFS.assets)) {
            if (path.includes(`bg/${stageFolder}/`)) {
                if (path.endsWith('.xml')) {
                    const propKey = path.split('/').pop().replace('.xml', '').toLowerCase();
                    stageProps[propKey] = await loadAnimatedProp(stageFolder, propKey);
                }
            }
        }

        playState = new PlayStateScene(item, dadChar, bfChar, gfChar, stageData, stageProps, stageJson, extraChars);

        activeCountdownTimer = setTimeout(() => {
            if (playState) {
                playState.showRating("GO!", 0x2ed573);
                const playTime = audioCtx.currentTime + 0.05;
                Conductor.activeSources.forEach(s => s.start(playTime));
                Conductor.start();
            }
            activeCountdownTimer = null;
        }, 1500);

    } catch(err) {
        console.error("Launch error:", err);
        alert("Failed to start song. Check console (F12).");
        returnToFreeplay();
    }
}

function returnToFreeplay() {
    if (activeCountdownTimer) {
        clearTimeout(activeCountdownTimer);
        activeCountdownTimer = null;
    }

    Conductor.stop();
    if (playState) {
        playState.destroy();
        playState = null;
    }

    videoOverlay.pause();
    videoOverlay.style.display = 'none';

    gameContainer.classList.add('hidden');
    freeplayScreen.classList.remove('hidden');
}
