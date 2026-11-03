extends SceneTree

func _initialize() -> void:
    call_deferred("_inspect")

func _inspect() -> void:
    var scene = load("res://scenes/main.tscn")
    if scene == null:
        push_error("PHOENIX Godot smoke: main scene not loaded")
        quit(3)
        return
    var instance = scene.instantiate()
    if instance == null:
        push_error("PHOENIX Godot smoke: main scene not instantiated")
        quit(4)
        return
    root.add_child(instance)
    var hero = instance.get_node_or_null("Hero")
    var boss = instance.get_node_or_null("Boss")
    if hero == null or boss == null or not boss.has_method("take_damage"):
        push_error("PHOENIX Godot smoke: hero or boss is missing gameplay logic")
        quit(5)
        return
    print("PHOENIX_GODOT_SMOKE_OK hero+boss+project")
    quit()
