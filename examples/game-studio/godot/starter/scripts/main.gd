extends Node2D
const HeroScript = preload("res://scripts/hero.gd")
const BossScript = preload("res://scripts/boss.gd")
var hero
var boss
var shots: Array[Dictionary] = []
var hud: Label

func _ready() -> void:
    hero = HeroScript.new()
    hero.name = "Hero"
    hero.position = Vector2(125, 340)
    add_child(hero)
    boss = BossScript.new()
    boss.name = "Boss"
    boss.position = Vector2(855, 330)
    boss.target = hero
    add_child(boss)
    hero.fired.connect(_hero_attack)
    boss.fired.connect(_boss_attack)
    hud = Label.new()
    hud.position = Vector2(20, 18)
    hud.add_theme_font_size_override("font_size", 17)
    add_child(hud)
    _status()

func _hero_attack(kind: String, origin: Vector2, motion: Vector2, damage: int) -> void:
    shots.append({"owner": "hero", "kind": kind, "at": origin,
        "velocity": motion, "damage": damage, "ttl": 2.0})

func _boss_attack(kind: String, origin: Vector2, motion: Vector2, damage: int) -> void:
    shots.append({"owner": "boss", "kind": kind, "at": origin,
        "velocity": motion, "damage": damage, "ttl": 3.0})

func _process(delta: float) -> void:
    for i in range(shots.size() - 1, -1, -1):
        var shot = shots[i]
        shot["at"] += shot["velocity"] * delta
        shot["ttl"] -= delta
        var radius = 70.0 if shot["kind"] == "whip" else (19.0 if shot["kind"] == "magic" else 9.0)
        if shot["owner"] == "hero" and boss.alive and shot["at"].distance_to(boss.global_position) < 45.0 + radius:
            boss.take_damage(shot["damage"])
            shots.remove_at(i)
        elif shot["owner"] == "boss" and shot["at"].distance_to(hero.global_position) < 18.0 + radius:
            hero.hp = maxi(0, hero.hp - shot["damage"])
            shots.remove_at(i)
        elif shot["ttl"] <= 0.0 or shot["at"].x < 0.0 or shot["at"].x > 1024.0:
            shots.remove_at(i)
    _status()
    queue_redraw()

func _status() -> void:
    hud.text = "ARROWS: MOVE    J: SHOOT    H: WHIP    L: MAGIC    |    HP: %d    BOSS: %d    PHASE: %d" % [hero.hp, boss.hp, boss.phase]
    if boss.hp == 0:
        hud.text += "   VICTORY"
    elif hero.hp == 0:
        hud.text += "   RETRY (R)"
    if hero.hp == 0 and Input.is_key_pressed(KEY_R):
        get_tree().reload_current_scene()

func _draw() -> void:
    draw_rect(Rect2(0, 413, 1024, 163), Color("#293e45"))
    for x in range(0, 1024, 80):
        draw_line(Vector2(x, 413), Vector2(x + 40, 413), Color("#4c6d62"), 4.0)
    for shot in shots:
        var color = Color("#67edff") if shot["kind"] == "magic" else (
            Color("#e6a85f") if shot["owner"] == "boss" else Color("#fff5af"))
        draw_circle(shot["at"], 15.0 if shot["kind"] == "magic" else 8.0, color)
