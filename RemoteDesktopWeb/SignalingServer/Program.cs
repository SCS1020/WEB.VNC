using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

// Bind to all network interfaces for both HTTP and HTTPS.
// Note: WebRTC Screen Sharing requires a Secure Context (HTTPS or localhost).
builder.WebHost.UseUrls("http://*:5000", "https://*:5001");

// Add services to the container.
builder.Services.AddSignalR();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyHeader()
               .AllowAnyMethod()
               .SetIsOriginAllowed((host) => true) // allow any origin
               .AllowCredentials();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles(); // Serve static files from wwwroot

app.MapGet("/api/pcname", (Microsoft.AspNetCore.Http.HttpContext context) =>
{
    var remoteIp = context.Connection.RemoteIpAddress;
    string pcName = "Unknown PC";

    if (remoteIp != null)
    {
        try
        {
            // Attempt reverse DNS lookup
            var hostEntry = System.Net.Dns.GetHostEntry(remoteIp);
            pcName = hostEntry.HostName.Split('.')[0]; // Get the short hostname
        }
        catch
        {
            pcName = $"PC-{remoteIp.ToString()}";
        }
    }

    return Microsoft.AspNetCore.Http.Results.Ok(new { pcName });
});

app.MapHub<SignalingHub>("/signalingHub");

app.Run();
