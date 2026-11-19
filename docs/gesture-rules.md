# Gesture Rules

The scene camera is controlled using one-hand and two-hand gestures. When one finger is extended, the application switches to Cursor Mode, and the camera remains stationary.

## Camera Mode

### Camera Movement (Left, Right, Up, Down)
- Activated when one hand is held up with an open palm facing the webcam.
- Moving the hand along the plane parallel to the webcam moves the scene camera in the same direction.
- Webcam mirroring must be accounted for: physically moving the hand left moves the camera left, and likewise for other directions.

### Camera Zoom
- Activated when both hands are held up with open palms.
- Increasing the distance between the hands (spreading them apart) zooms in.
- Decreasing the distance between the hands (bringing them together) zooms out.

### Camera Rotation
- Activated when one hand is held up with exactly two fingers extended.
- Moving the hand left or right rotates the camera around the Y axis in the corresponding direction.

## Cursor Mode

### Cursor Movement
- Activated when one hand is held up with only the index finger extended.
- The camera stops moving and retains its current position and orientation.
- An on-screen cursor appears and follows the movement of the extended fingertip.
- The cursor's 2D screen position is used for raycasting into the 3D scene.

### Object Selection
- While in Cursor Mode, quickly bending the extended index finger triggers object selection.
- A ray is cast from the camera through the cursor's current screen position.
- If the ray intersects a selectable object, that object is selected.
- Each finger-bending gesture triggers only one selection event.
