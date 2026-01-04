// In-memory undo stack (not persisted across page reloads)

const undoStack = [];

export const pushUndo = (record) => {
  undoStack.push(record);
};

export const popUndo = () => {
  return undoStack.pop() || null;
};

export const hasUndo = () => undoStack.length > 0;

export const clearUndo = () => {
  undoStack.length = 0;
};
