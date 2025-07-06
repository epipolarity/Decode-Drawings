import { arrayToTextLines, map } from "./utils.js";

// version 1 of the drawing decoder class
// very naively calculates x and y coordinates from ball radii only
// assumes that camera position x and y are equivalent to pen tip x and y
export default class DrawingDecoder {

    constructor() {
        this.collector = [];                // collector stores the decoded XY image coordinates for later export
    }


    // takes a 2d context to draw onto and a 'balls' object describing the size and position of each ball in the current frame
    decode(ctx, balls) {

        // use getX and getY function to get estimated camera XY position
        const x = this.#getX(balls);                    
        const y = this.#getY(balls);

        // udpate drawing if camera (pen) has moved
        if (this.lastPosition && x != this.lastPosition.x && y != this.lastPosition.y) {

            // draw from last position to current position
            ctx.beginPath();
            ctx.moveTo(this.lastPosition.x, this.lastPosition.y);
            ctx.lineTo(x, y);
            ctx.stroke();

            // store x and y canvas integer pixel coordinates
            this.collector.push(Math.round(x) + ' ' + Math.round(y));

        }

        // update last position
        this.lastPosition = { x, y };
    }


    // estimate x position of camera from detected 'balls' object
    // assumes that camera is further to the right if green ball is larger and vice versa
    #getX(balls) {

        // only consider green and blue balls
        const { green, blue } = balls;                                          

        // get difference in radii
        const blueGreenSizeDiff = green.radius - blue.radius;

        // map observed difference values to canvas pixel range
        return map(blueGreenSizeDiff, -10, 10, 200, 500);
    }


    // estimate y position of camera from detected 'balls' object
    // assumes that balls will appear smaller as camera moves back away from them
    #getY(balls) {

        // consider all the balls
        const { red, green, blue } = balls

        // get the average radius of all balls
        const meanRadius = (red.radius + green.radius + blue.radius) / 3;

        // map observed radii to canvas pixel range
        return map(meanRadius, 50, 100, 500, 200);
    }


    // return the string representation of the collector
    // a string of space-separated XY pairs on each line
    toString() {
        return arrayToTextLines(this.collector);
    }

}