/* ==========================================================================
   COLREG 3D — 3D scene & render engine
   STATUS: placeholder. Implemented in STEP 2.

   STEP 2 will own, in this file:
     • WebGLRenderer (pixel-ratio capped at 2, or 1 when prefs.perf === 'lite')
     • PerspectiveCamera + OrbitControls with a polar-angle clamp so the eye
       can never drop below the sea surface
     • Shader-based water plane, fog, and the day/night lighting rig
     • The camera→vessel relative-bearing calculation that drives the
       Aspect Angle Meter (main.js `setAspect`) every frame
     • A `dispose()` that releases geometries, materials and the GL context
       when the scene is torn down or reset

   The signature below is the contract main.js already calls against, so
   STEP 2 can fill this in without touching the shell.
   ========================================================================== */

/**
 * @param {{host: HTMLElement|null, bus: EventTarget, prefs: object}} ctx
 * @returns {Promise<{pending: boolean, dispose: () => void}>}
 */
export async function initScene(ctx) {
  const { host } = ctx;

  if (host) {
    host.innerHTML = '';

    const note = document.createElement('div');
    note.className = 'placeholder';
    note.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'max-width:min(380px,78%);text-align:center;';
    note.innerHTML =
      '<p><strong>3D viewport</strong></p>' +
      '<p>Ocean, vessel and light sectors are delivered in STEP&nbsp;2–3.</p>';
    host.append(note);
  }

  return {
    pending: true,
    dispose() { if (host) host.innerHTML = ''; }
  };
}
