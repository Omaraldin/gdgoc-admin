import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

const editor = new Editor({
  extensions: [
    StarterKit,
    Link,
    Image.extend({ marks: 'link' })
  ],
  content: '<p><img src="test.png"></p>'
});

editor.commands.setNodeSelection(2); // Position 2 should be the image in a <p>
editor.commands.setLink({ href: 'https://example.com' });
console.log(editor.getHTML());
