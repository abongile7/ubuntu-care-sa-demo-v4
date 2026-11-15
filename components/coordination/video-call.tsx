"use client";

import { useEffect, useRef, useState } from "react";

type VideoCallProps = {
  appointmentId: string;
  onBusyChange?: (busy: boolean) => void;
  onEnded?: () => void;
};
type Signal = {
  id: string;
  kind: "OFFER" | "ANSWER" | "ICE";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
};
type VideoResponse = {
  ok: boolean;
  message?: string;
  room?: { id: string; status: string };
  isOfferer?: boolean;
  participants?: number;
  signals?: Signal[];
};

async function videoRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/portal/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await response.json()) as VideoResponse;
  if (!response.ok || !data.ok) throw new Error(data.message ?? "Unable to update the video call.");
  return data;
}

export function VideoCall({ appointmentId, onBusyChange, onEnded }: VideoCallProps) {
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "joining" | "waiting" | "connected" | "ended" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const roomId = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const busyCallback = useRef(onBusyChange);
  const endedCallback = useRef(onEnded);
  const mounted = useRef(true);
  busyCallback.current = onBusyChange;
  endedCallback.current = onEnded;

  function cleanup() {
    generation.current++;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    if (peer.current) {
      peer.current.ontrack = null;
      peer.current.onicecandidate = null;
      peer.current.onconnectionstatechange = null;
      peer.current.close();
    }
    peer.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    busyCallback.current?.(false);
  }

  function endCall() {
    const currentRoom = roomId.current;
    roomId.current = null;
    cleanup();
    setPhase("ended");
    setMessage("Call ended. Camera and microphone have stopped.");
    if (currentRoom) {
      void fetch("/api/portal/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", roomId: currentRoom }),
        keepalive: true
      }).finally(() => endedCallback.current?.());
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const currentRoom = roomId.current;
      roomId.current = null;
      cleanup();
      if (currentRoom)
        void fetch("/api/portal/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "leave", roomId: currentRoom }),
          keepalive: true
        });
    };
    // An appointment change is handled by the parent's keyed component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join() {
    if (!consent || phase === "joining" || peer.current) return;
    busyCallback.current?.(true);
    setPhase("joining");
    setMessage("Requesting camera and microphone access…");
    const attempt = ++generation.current;
    let stream: MediaStream | null = null;
    let joinedRoom: string | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
        throw new Error(
          "Your browser needs camera and microphone support over HTTPS or localhost."
        );
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!mounted.current || generation.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStream.current = stream;
      if (localVideo.current) {
        localVideo.current.srcObject = stream;
        void localVideo.current.play().catch(() => {});
      }
      const joined = await videoRequest({ appointmentId, action: "join", consentConfirmed: true });
      joinedRoom = joined.room?.id ?? null;
      if (!joinedRoom) throw new Error("The appointment's video room could not be opened.");
      if (!mounted.current || generation.current !== attempt) {
        await videoRequest({ action: "leave", roomId: joinedRoom }).catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      roomId.current = joinedRoom;
      // No third party STUN, TURN, room provider, or recording is configured.
      const connection = new RTCPeerConnection({ iceServers: [] });
      peer.current = connection;
      const remote = new MediaStream();
      if (remoteVideo.current) remoteVideo.current.srcObject = remote;
      stream.getTracks().forEach((track) => connection.addTrack(track, stream!));
      connection.ontrack = (event) => {
        event.streams
          .flatMap((item) => item.getTracks())
          .forEach((track) => {
            if (!remote.getTrackById(track.id)) remote.addTrack(track);
          });
        if (!remote.getTrackById(event.track.id)) remote.addTrack(event.track);
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remote;
          void remoteVideo.current.play().catch(() => {});
        }
      };
      let outbound = Promise.resolve();
      const sendSignal = (
        kind: string,
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit
      ) => {
        const operation = outbound.then(async () => {
          if (generation.current === attempt)
            await videoRequest({ action: "signal", roomId: joinedRoom, kind, payload });
        });
        outbound = operation.catch((error) => {
          if (mounted.current && generation.current === attempt)
            setMessage(error instanceof Error ? error.message : "A connection signal failed.");
        });
        return operation;
      };
      connection.onicecandidate = (event) => {
        if (event.candidate)
          void sendSignal("ICE", {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          }).catch(() => {});
      };
      connection.onconnectionstatechange = () => {
        if (!mounted.current || generation.current !== attempt) return;
        if (connection.connectionState === "connected") {
          setPhase("connected");
          setMessage("Connected. This call is not recorded.");
        }
        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "disconnected"
        )
          setMessage(
            "Connection interrupted. This local demo has no TURN relay; end the call if it does not recover."
          );
      };
      const seen = new Set<string>();
      const pendingIce: RTCIceCandidateInit[] = [];
      let polling = false;
      let offerSent = false;
      const flushIce = async () => {
        while (pendingIce.length && connection.remoteDescription)
          await connection.addIceCandidate(pendingIce.shift()!);
      };
      const poll = async () => {
        if (polling || generation.current !== attempt) return;
        polling = true;
        try {
          const response = await fetch(
            `/api/portal/video?roomId=${encodeURIComponent(joinedRoom!)}`,
            { cache: "no-store" }
          );
          const data = (await response.json()) as VideoResponse;
          if (!mounted.current || generation.current !== attempt) return;
          if (!response.ok || !data.ok) {
            if ([401, 403, 404, 409].includes(response.status)) {
              roomId.current = null;
              cleanup();
              setPhase("ended");
              setMessage(data.message ?? "The call is no longer available.");
              endedCallback.current?.();
              return;
            }
            throw new Error(data.message ?? "Could not check the call connection.");
          }
          for (const signal of data.signals ?? []) {
            if (!mounted.current || generation.current !== attempt) return;
            if (seen.has(signal.id)) continue;
            if (signal.kind === "ICE") {
              if (connection.remoteDescription)
                await connection.addIceCandidate(signal.payload as RTCIceCandidateInit);
              else pendingIce.push(signal.payload as RTCIceCandidateInit);
            } else if (
              signal.kind === "OFFER" &&
              !joined.isOfferer &&
              !connection.remoteDescription
            ) {
              await connection.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
              await flushIce();
              const answer = await connection.createAnswer();
              await connection.setLocalDescription(answer);
              await sendSignal("ANSWER", { type: "answer", sdp: connection.localDescription!.sdp });
            } else if (
              signal.kind === "ANSWER" &&
              joined.isOfferer &&
              !connection.remoteDescription
            ) {
              await connection.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
              await flushIce();
            }
            seen.add(signal.id);
          }
          // Wait for the peer before offering: a lone participant may wait
          // longer than the short signaling TTL.
          if (joined.isOfferer && (data.participants ?? 0) === 2 && !offerSent) {
            offerSent = true;
            const offer = await connection.createOffer();
            if (!mounted.current || generation.current !== attempt) return;
            await connection.setLocalDescription(offer);
            if (!mounted.current || generation.current !== attempt) return;
            await sendSignal("OFFER", { type: "offer", sdp: connection.localDescription!.sdp });
          }
        } catch (error) {
          if (mounted.current && generation.current === attempt)
            setMessage(error instanceof Error ? error.message : "Could not connect the call.");
        } finally {
          polling = false;
        }
      };
      if (!mounted.current || generation.current !== attempt) return;
      setPhase("waiting");
      setMessage("Waiting for the other participant to join and connect…");
      pollTimer.current = setInterval(() => {
        void poll();
      }, 1500);
      void poll();
    } catch (error) {
      if (joinedRoom) await videoRequest({ action: "leave", roomId: joinedRoom }).catch(() => {});
      roomId.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      cleanup();
      if (mounted.current) {
        setPhase("error");
        setMessage(
          error instanceof DOMException &&
            ["NotAllowedError", "PermissionDeniedError"].includes(error.name)
            ? "Camera or microphone permission was denied. Allow access in your browser, then try again."
            : error instanceof Error
              ? error.message
              : "Unable to start the video call."
        );
      }
    }
  }

  const active = phase === "waiting" || phase === "connected";
  return (
    <section className="portal-video-call" aria-label="Appointment video call">
      <h4>Private video appointment</h4>
      <p>
        Only the patient and assigned clinician can join. Camera and microphone are shared with the
        other participant. Calls are not recorded.
      </p>
      <p className="portal-muted">
        Local demonstration: no external media service or relay. Reliable calls across different
        networks require a configured and validated TURN service before a pilot.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))",
          gap: 12
        }}
      >
        <figure style={{ margin: 0 }}>
          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            aria-label="Your camera preview"
            style={{ width: "100%", minHeight: 140, background: "#102f35", borderRadius: 12 }}
          />
          <figcaption>Your camera {cameraOff ? "(off)" : ""}</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            aria-label="Remote participant video"
            style={{ width: "100%", minHeight: 140, background: "#102f35", borderRadius: 12 }}
          />
          <figcaption>Other participant</figcaption>
        </figure>
      </div>
      <p role="status" aria-live="polite">
        {message || "Review consent to join the call."}
      </p>
      {(phase === "idle" || phase === "error") && (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I understand and consent to this video consultation and to sharing my camera and
            microphone with the other participant. I can end the call at any time.
          </label>
          <button type="button" onClick={() => void join()} disabled={!consent}>
            Join video call
          </button>
        </>
      )}
      {phase === "joining" && (
        <button type="button" onClick={endCall}>
          Cancel joining
        </button>
      )}
      {active && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              localStream.current?.getAudioTracks().forEach((track) => {
                track.enabled = muted;
              });
              setMuted(!muted);
            }}
          >
            {muted ? "Unmute microphone" : "Mute microphone"}
          </button>
          <button
            type="button"
            onClick={() => {
              localStream.current?.getVideoTracks().forEach((track) => {
                track.enabled = cameraOff;
              });
              setCameraOff(!cameraOff);
            }}
          >
            {cameraOff ? "Turn camera on" : "Turn camera off"}
          </button>
          <button type="button" onClick={endCall}>
            End video call
          </button>
        </div>
      )}
    </section>
  );
}
