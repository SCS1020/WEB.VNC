using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

public class SignalingHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        // Send the connection ID back to the user upon connecting
        // This will act as their "Device ID"
        await Clients.Caller.SendAsync("ReceiveConnectionId", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public async Task SendOffer(string targetConnectionId, string offer)
    {
        // Route the offer to the target device
        await Clients.Client(targetConnectionId).SendAsync("ReceiveOffer", Context.ConnectionId, offer);
    }

    public async Task SendAnswer(string targetConnectionId, string answer)
    {
        // Route the answer back to the host device
        await Clients.Client(targetConnectionId).SendAsync("ReceiveAnswer", Context.ConnectionId, answer);
    }

    public async Task SendIceCandidate(string targetConnectionId, string candidate)
    {
        // Route ICE candidates to the target device
        await Clients.Client(targetConnectionId).SendAsync("ReceiveIceCandidate", Context.ConnectionId, candidate);
    }
}
