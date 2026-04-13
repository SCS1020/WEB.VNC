using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Runtime.InteropServices;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5005"); // Local only

// SECURITY: Restrict CORS to specific web signaling origins to prevent CSRF attacks.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        // Allow the local signaling server origins
        policy.WithOrigins("http://localhost:5000", "https://localhost:5001")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors();

// Middleware to enforce JSON content type (forces CORS preflight on POST)
app.Use(async (context, next) =>
{
    if (context.Request.Method == HttpMethods.Post &&
        !context.Request.HasJsonContentType())
    {
        context.Response.StatusCode = StatusCodes.Status415UnsupportedMediaType;
        return;
    }
    await next();
});

app.MapPost("/api/input/mouse", async (HttpContext context) =>
{
    var doc = await JsonDocument.ParseAsync(context.Request.Body);
    var root = doc.RootElement;

    if (root.TryGetProperty("type", out var typeProp))
    {
        string type = typeProp.GetString() ?? "";

        // Get screen resolution for absolute coordinates mapping
        double screenWidth = Win32Input.GetSystemMetrics(Win32Input.SM_CXSCREEN);
        double screenHeight = Win32Input.GetSystemMetrics(Win32Input.SM_CYSCREEN);

        if (type == "mousemove")
        {
            double x = root.GetProperty("x").GetDouble();
            double y = root.GetProperty("y").GetDouble();

            // Convert normalized coordinates (0.0 to 1.0) to absolute mouse coordinates (0 to 65535)
            int absX = (int)(x * 65535.0f);
            int absY = (int)(y * 65535.0f);

            Win32Input.SendMouseMove(absX, absY);
        }
        else if (type == "click")
        {
            Win32Input.SendMouseClick();
        }
    }

    return Results.Ok();
});

app.MapPost("/api/input/key", async (HttpContext context) =>
{
    var doc = await JsonDocument.ParseAsync(context.Request.Body);
    var root = doc.RootElement;

    if (root.TryGetProperty("type", out var typeProp))
    {
        string type = typeProp.GetString() ?? "";
        string key = root.GetProperty("key").GetString() ?? "";
        string code = root.GetProperty("code").GetString() ?? "";

        ushort scanCode = Win32Input.GetScanCode(code);
        if (scanCode > 0)
        {
            if (type == "keydown")
            {
                Win32Input.SendKey(scanCode, false);
            }
            else if (type == "keyup")
            {
                Win32Input.SendKey(scanCode, true);
            }
        }
    }

    return Results.Ok();
});

app.Run();

// --- Win32 P/Invoke Wrapper ---
public static class Win32Input
{
    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public MOUSEKEYBDHARDWAREINPUT Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct MOUSEKEYBDHARDWAREINPUT
    {
        [FieldOffset(0)]
        public MOUSEINPUT Mouse;
        [FieldOffset(0)]
        public KEYBDINPUT Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;

    const uint KEYEVENTF_SCANCODE = 0x0008;
    const uint KEYEVENTF_KEYUP = 0x0002;

    public static void SendMouseMove(int absX, int absY)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].Data.Mouse = new MOUSEINPUT
        {
            dx = absX,
            dy = absY,
            dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        };
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendMouseClick()
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].Data.Mouse = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTDOWN };

        inputs[1].type = INPUT_MOUSE;
        inputs[1].Data.Mouse = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTUP };

        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendKey(ushort scanCode, bool isKeyUp)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].Data.Keyboard = new KEYBDINPUT
        {
            wScan = scanCode,
            dwFlags = KEYEVENTF_SCANCODE | (isKeyUp ? KEYEVENTF_KEYUP : 0)
        };
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    // Comprehensive map of common JS KeyboardEvent.code to hardware scan codes
    public static ushort GetScanCode(string jsCode)
    {
        return jsCode switch
        {
            "Escape" => 0x01,
            "Digit1" => 0x02, "Digit2" => 0x03, "Digit3" => 0x04, "Digit4" => 0x05, "Digit5" => 0x06, "Digit6" => 0x07, "Digit7" => 0x08, "Digit8" => 0x09, "Digit9" => 0x0A, "Digit0" => 0x0B,
            "Minus" => 0x0C, "Equal" => 0x0D, "Backspace" => 0x0E, "Tab" => 0x0F,
            "KeyQ" => 0x10, "KeyW" => 0x11, "KeyE" => 0x12, "KeyR" => 0x13, "KeyT" => 0x14, "KeyY" => 0x15, "KeyU" => 0x16, "KeyI" => 0x17, "KeyO" => 0x18, "KeyP" => 0x19,
            "BracketLeft" => 0x1A, "BracketRight" => 0x1B, "Enter" => 0x1C, "ControlLeft" => 0x1D,
            "KeyA" => 0x1E, "KeyS" => 0x1F, "KeyD" => 0x20, "KeyF" => 0x21, "KeyG" => 0x22, "KeyH" => 0x23, "KeyJ" => 0x24, "KeyK" => 0x25, "KeyL" => 0x26,
            "Semicolon" => 0x27, "Quote" => 0x28, "Backquote" => 0x29, "ShiftLeft" => 0x2A, "Backslash" => 0x2B,
            "KeyZ" => 0x2C, "KeyX" => 0x2D, "KeyC" => 0x2E, "KeyV" => 0x2F, "KeyB" => 0x30, "KeyN" => 0x31, "KeyM" => 0x32,
            "Comma" => 0x33, "Period" => 0x34, "Slash" => 0x35, "ShiftRight" => 0x36, "NumpadMultiply" => 0x37, "AltLeft" => 0x38, "Space" => 0x39,
            "CapsLock" => 0x3A, "F1" => 0x3B, "F2" => 0x3C, "F3" => 0x3D, "F4" => 0x3E, "F5" => 0x3F, "F6" => 0x40, "F7" => 0x41, "F8" => 0x42, "F9" => 0x43, "F10" => 0x44,
            "NumLock" => 0x45, "ScrollLock" => 0x46, "Numpad7" => 0x47, "Numpad8" => 0x48, "Numpad9" => 0x49, "NumpadSubtract" => 0x4A,
            "Numpad4" => 0x4B, "Numpad5" => 0x4C, "Numpad6" => 0x4D, "NumpadAdd" => 0x4E, "Numpad1" => 0x4F, "Numpad2" => 0x50, "Numpad3" => 0x51, "Numpad0" => 0x52, "NumpadDecimal" => 0x53,
            "F11" => 0x57, "F12" => 0x58,
            "ArrowUp" => 0xC8, "ArrowLeft" => 0xCB, "ArrowRight" => 0xCD, "ArrowDown" => 0xD0,
            "Delete" => 0xD3,
            _ => 0
        };
    }
}
