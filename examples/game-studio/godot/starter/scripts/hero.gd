extends CharacterBody2D
signal fired(kind: String, origin: Vector2, direction: Vector2, damage: int)
const SPEED = 250.0
var face = 1.0
var elapsed = 0.0
var shoot_wait = 0.0
var magic_wait = 0.0
var whip_wait = 0.0
var attack_until = 0.0
var magic_until = 0.0
var hp = 8

func _ready() -> void:
    var collision = CollisionShape2D.new()
    var shape = CircleShape2D.new()
    shape.radius = 19.0
    collision.shape = shape
    add_child(collision)

func _physics_process(delta: float) -> void:
    elapsed += delta
    shoot_wait = maxf(0.0, shoot_wait - delta)
    magic_wait = maxf(0.0, magic_wait - delta)
    whip_wait = maxf(0.0, whip_wait - delta)
    var horizontal = Input.get_axis("ui_left", "ui_right")
    if absf(horizontal) > 0.01:
        face = signf(horizontal)
    velocity = Vector2(horizontal * SPEED, 0.0)
    move_and_slide()
    position.x = clampf(position.x, 35.0, 985.0)
    if hp <= 0:
        queue_redraw()
        return
    if Input.is_key_pressed(KEY_J) and shoot_wait <= 0.0:
        shoot_wait = 0.18
        attack_until = elapsed + 0.15
        fired.emit("bullet", global_position + Vector2(face * 31.0, -10),
            Vector2(face * 590.0, 0), 1)
    if Input.is_key_pressed(KEY_L) and magic_wait <= 0.0:
        magic_wait = 2.6
        magic_until = elapsed + 0.38
        fired.emit("magic", global_position + Vector2(face * 34.0, -9),
            Vector2(face * 370.0, 0), 4)
    if Input.is_key_pressed(KEY_H) and whip_wait <= 0.0:
        whip_wait = 0.70
        attack_until = elapsed + 0.25
        fired.emit("whip", global_position + Vector2(face * 46.0, 0), Vector2.ZERO, 2)
    queue_redraw()

func _draw() -> void:
    # These moving primitives are placeholders. Final games MUST consume
    # actual approved sprites via AnimatedSprite2D / AnimationPlayer.
    var stride = sin(elapsed * 13.0) * (11.0 if absf(velocity.x) > 1.0 else 2.0)
    draw_line(Vector2(-9, 12), Vector2(-9 + stride, 29), Color("#80c9f7"), 8.0)
    draw_line(Vector2(9, 12), Vector2(9 - stride, 29), Color("#80c9f7"), 8.0)
    draw_circle(Vector2.ZERO, 19.0, Color("#4274bd"))
    draw_circle(Vector2(0, -22), 11.0, Color("#efc28c"))
    draw_line(Vector2(face * 8.0, -2), Vector2(face * (34.0 if elapsed < attack_until else 22.0), -9),
        Color("#e4eefa"), 7.0)
    if elapsed < magic_until:
        draw_arc(Vector2.ZERO, 36.0 + sin(elapsed * 35.0) * 5.0, 0.0, TAU, 24,
            Color("#4af0fd"), 3.0, true)
