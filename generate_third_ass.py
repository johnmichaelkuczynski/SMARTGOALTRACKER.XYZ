import math

text_blocks = [
    "Want a diary that talks back?",
    "Want a diary that knows you?",
    "Well, now you have one.",
    "Smart Goal Tracker\\Nisn’t just a calendar.",
    "It works with you.",
    "It knows about you and constantly updates\\Nits understanding of who you are",
    "and what you are trying to do.",
    "It remembers what you have said,\\Nknows how you have grown,",
    "and knows how you can\\Noptimize yourself.",
    "Take the Interactive Diary.",
    "You write in your diary—\\Nand it writes back.",
    "And it’s smart because it knows you.",
    "Smart Goal Tracker.",
    "How can we make your life easier?"
]

chars = [len(t.replace('\\N', ' ')) for t in text_blocks]
pauses = [0.4, 0.4, 0.4, 0.4, 0.4, 0.0, 0.4, 0.0, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]

total_chars = sum(chars)
total_audio_time = 32.78
total_pauses = sum(pauses)

time_for_chars = total_audio_time - total_pauses
time_per_char = time_for_chars / total_chars

current_time = 0.0

def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    if cs == 100:
        cs = 99
    return f"0:{mins:02d}:{secs:02d}.{cs:02d}"

print("[Script Info]")
print("ScriptType: v4.00+")
print("PlayResX: 1280")
print("PlayResY: 720")
print("ScaledBorderAndShadow: yes")
print("WrapStyle: 2")
print("")
print("[V4+ Styles]")
print("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")
print("Style: Caption,Arial,30,&H00FFFFFF,&H000000FF,&H0013141A,&HA0000000,-1,0,0,0,100,100,0,0,3,8,0,2,70,70,32,1")
print("")
print("[Events]")
print("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

for i, text in enumerate(text_blocks):
    duration = chars[i] * time_per_char
    start_time = current_time
    end_time = start_time + duration
    
    print(f"Dialogue: 0,{format_time(start_time)},{format_time(end_time)},Caption,,0,0,0,,{text}")
    
    current_time = end_time + pauses[i]
