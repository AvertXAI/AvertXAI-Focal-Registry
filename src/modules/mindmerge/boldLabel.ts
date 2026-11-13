// The one test for "this bold text is a label", shared by the editor's reader and the preview
// pane so the two can never disagree about `(**Note:**x)`.

/** `Note:` is a label. `a,` and `opts` are code: the same asterisks after a bracket are usually `f(**a,**b)`. */
export const isBoldLabel = (text: string): boolean => /:$/u.test(text) && /\p{L}/u.test(text) && !/[,()=*]/u.test(text);
