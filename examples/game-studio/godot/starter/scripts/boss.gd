extends Node2D
signal fired(kind: String, origin: Vector2, velocity: Vector2, damage: int)
var target: Node2D
var hp = 24
var phase = 1
var elapsed = 0.0
var recovery = 1.0
var windup = 0.0
var attack_number = 0
var attack_kind = ""
var alive = true

func take_damage(damage: int) -> void:
    if not alive:
        return
    hp = maxi(0, hp - damage)
    phase = 2 if hp <= 12 else 1
    if hp == 0:
        alive = false
    queue_redraw()

func _process(delta: float) -> void:
    if not alive or target == null:
        return
    elapsed += delta
    position.y = 330.0 + sin(elapsed * 1.4) * 12.0
    if recovery > 0.0:
        recovery -= delta
    elif windup <= 0.0 and attack_kind == "":
        attack_kind = "bolt" if phase == 1 else ("fan" if attack_number % 2 == 0 else "wave")
        windup = 0.82 if phase == 1 else 0.55
        attack_number += 1
    elif windup > 0.0:
        windup -= delta
        if windup <= 0.0:
            var toward = (target.global_position - global_position).normalized()
            var from = global_position + Vector2(-32, -20)
            if attack_kind == "fan":
                for angle in [-0.32, 0.0, 0.32]:
                    fired.emit("fan", from, toward.rotated(angle) * 290.0, 1)
            elif attack_kind == "wave":
                fired.emit("wave", global_position + Vector2(-34, 41), Vector2(-300, 0), 2)
            else:
                fired.emit("bolt", from, toward * 240.0, 1)
            attack_kind = ""
            recovery = 0.65 if phase == 2 else 1.0
    queue_redraw()

func _draw() -> void:
    if not alive:
        return
    var stride = sin(elapsed * 8.0) * 13.0
    draw_line(Vector2(-18, 25), Vector2(-27 + stride, 50), Color("#9f5660"), 13.0)
    draw_line(Vector2(22, 25), Vector2(33 - stride, 50), Color("#9f5660"), 13.0)
    draw_circle(Vector2.ZERO, 39.0, Color("#94445c") if phase == 1 else Color("#b92f30"))
    draw_line(Vector2(-30, -7), Vector2(-64 - stride, -14), Color("#c38c9e"), 12.0)
    draw_line(Vector2(30, -7), Vector2(63 + stride, -22), Color("#c38c9e"), 12.0)
    if windup > 0.0:
        draw_arc(Vector2.ZERO, 55.0 + sin(elapsed * 30.0) * 4.0, 0.0, TAU, 36,
            Color("#ffc674"), 5.0, true)
