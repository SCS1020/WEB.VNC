using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

public class HostInfo
{
    public string ConnectionId { get; set; } = string.Empty;
    public string PcName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class SignalingHub : Hub
{
    // In-memory store for active hosts. For production, consider Redis or database.
    private static ConcurrentDictionary<string, HostInfo> ActiveHosts = new ConcurrentDictionary<string, HostInfo>();

    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("ReceiveConnectionId", Context.ConnectionId);
        await SendHostListToClient(Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (ActiveHosts.TryRemove(Context.ConnectionId, out _))
        {
            await BroadcastHostList();
        }
        await base.OnDisconnectedAsync(exception);
    }

    public async Task RegisterHost(string pcName, string password)
    {
        var hostInfo = new HostInfo
        {
            ConnectionId = Context.ConnectionId,
            PcName = pcName,
            Password = password
        };
        ActiveHosts[Context.ConnectionId] = hostInfo;
        await BroadcastHostList();
    }

    public async Task StopHosting()
    {
        if (ActiveHosts.TryRemove(Context.ConnectionId, out _))
        {
            await BroadcastHostList();
        }
    }

    private async Task BroadcastHostList()
    {
        var hosts = ActiveHosts.Values.Select(h => new { h.ConnectionId, h.PcName }).ToList();
        await Clients.All.SendAsync("UpdateHostList", hosts);
    }

    private async Task SendHostListToClient(string connectionId)
    {
        var hosts = ActiveHosts.Values.Select(h => new { h.ConnectionId, h.PcName }).ToList();
        await Clients.Client(connectionId).SendAsync("UpdateHostList", hosts);
    }

    public async Task SendOffer(string targetConnectionId, string offer, string password)
    {
        if (ActiveHosts.TryGetValue(targetConnectionId, out var hostInfo))
        {
            if (hostInfo.Password == password)
            {
                await Clients.Client(targetConnectionId).SendAsync("ReceiveOffer", Context.ConnectionId, offer);
            }
            else
            {
                await Clients.Caller.SendAsync("ConnectionFailed", "Invalid password.");
            }
        }
        else
        {
            await Clients.Caller.SendAsync("ConnectionFailed", "Host not found or offline.");
        }
    }

    public async Task SendAnswer(string targetConnectionId, string answer)
    {
        await Clients.Client(targetConnectionId).SendAsync("ReceiveAnswer", Context.ConnectionId, answer);
    }

    public async Task SendIceCandidate(string targetConnectionId, string candidate)
    {
        await Clients.Client(targetConnectionId).SendAsync("ReceiveIceCandidate", Context.ConnectionId, candidate);
    }
}
