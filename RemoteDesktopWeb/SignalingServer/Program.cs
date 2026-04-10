using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

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

app.MapHub<SignalingHub>("/signalingHub");

app.Run();
